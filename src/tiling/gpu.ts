// The tiling analysis' per-pixel kernels on the GPU (docs/features/fr9-tiling-workspace.md): the render box-filtered to
// the work size and turned into OKLab, its Sobel gradient, the blurs and colour rarity, and the line sums — the same
// arithmetic as `tilingKernels` in analyze.ts (the reference), ≈1000 × faster than it on the CPU. Everything after
// them (medians, quantiles, the low band, the scores) stays on the CPU, from one readback.
//
// Every loop's bound is a uniform (D3D can't unroll it) and nothing uses `continue` (ANGLE / D3D11 can miscompile it,
// AGENTS.md). Wrapping uses texelFetch with integer indices, made positive before `%` (negative `%` is undefined).
//
//   const k = tilingGpu(engine.gpu)          // null when the GPU's result doesn't match the CPU's (then use the CPU)
//   analyzeTiling(image, opts, k)

import * as THREE from 'three';
import { ScratchPool, type Gpu } from '@/gpu/context';
import type { MatchImage } from '@/match/image';
import {
	RARITY_KERNEL,
	TILING_TERMS,
	finishAnalysis,
	tilingGeometry,
	tilingKernels,
	workLab,
	workSize,
	type TilingKernelSource,
	type TilingKernels
} from './analyze';

const LAB = /* glsl */ `
vec3 oklab(vec3 c) {
  vec3 lms = vec3(
    dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
    dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
    dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  lms = pow(max(lms, vec3(0.0)), vec3(1.0 / 3.0));
  return vec3(
    dot(lms, vec3(0.2104542553, 0.793617785, -0.0040720468)),
    dot(lms, vec3(1.9779984951, -2.428592205, 0.4505937099)),
    dot(lms, vec3(0.0259040371, 0.7827717662, -0.808675766)));
}
`;

/**
 * Box filter along one axis (area average, as match/image.ts' resample 'box'): output texel i covers source
 * [i · uScale, (i + 1) · uScale). The first pass (uFirst) reads the sRGB render and filters linear, premultiplied
 * colour; the second ends in OKLab over mid grey (toOklab's background) with alpha in w.
 */
const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform ivec2 uAxis;
uniform float uScale;
uniform int uTaps;
uniform int uSrcLen;
uniform bool uFirst;
out vec4 oColor;
${LAB}
vec4 premulLinear(vec4 c) {
  vec3 s = clamp(c.rgb, 0.0, 1.0);
  vec3 lin = mix(pow((s + 0.055) / 1.055, vec3(2.4)), s / 12.92, vec3(lessThanEqual(s, vec3(0.04045))));
  return vec4(lin * c.a, c.a);
}
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int i = q.x * uAxis.x + q.y * uAxis.y;
  float a = float(i) * uScale;
  float b = float(i + 1) * uScale;
  int s0 = int(floor(a));
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int t = 0; t < uTaps; t++) {
    int s = s0 + t;
    float w = max(0.0, min(b, float(s + 1)) - max(a, float(s)));
    ivec2 p = q * (ivec2(1) - uAxis) + uAxis * min(s, uSrcLen - 1);
    vec4 c = texelFetch(tSrc, p, 0);
    sum += w * (uFirst ? premulLinear(c) : c);
    wsum += w;
  }
  sum /= max(wsum, 1e-12);
  if (uFirst) { oColor = sum; return; }
  float al = clamp(sum.a, 0.0, 1.0);
  vec3 rgb = clamp(sum.rgb * (sum.a > 1e-6 ? 1.0 / sum.a : 0.0), 0.0, 1.0);
  rgb = mix(vec3(0.2140411405), rgb, al); // mid grey (sRGB 0.5) in linear light
  oColor = vec4(oklab(rgb), al);
}
`;

/** Sobel of L, wrapping: (gx, gy) per px (/8) and the magnitude. */
const SOBEL = /* glsl */ `
uniform sampler2D tLab;
uniform ivec2 uSize;
out vec4 oColor;
float L(ivec2 p) { return texelFetch(tLab, p % uSize, 0).x; }
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy) + uSize;
  float gx = (L(q + ivec2(1, -1)) + 2.0 * L(q + ivec2(1, 0)) + L(q + ivec2(1, 1))
    - L(q + ivec2(-1, -1)) - 2.0 * L(q + ivec2(-1, 0)) - L(q + ivec2(-1, 1))) / 8.0;
  float gy = (L(q + ivec2(-1, 1)) + 2.0 * L(q + ivec2(0, 1)) + L(q + ivec2(1, 1))
    - L(q + ivec2(-1, -1)) - 2.0 * L(q + ivec2(0, -1)) - L(q + ivec2(1, -1))) / 8.0;
  oColor = vec4(gx, gy, length(vec2(gx, gy)), 0.0);
}
`;

/** Circular box blur of radius uR along one axis. */
const BLUR = /* glsl */ `
uniform sampler2D tSrc;
uniform ivec2 uAxis;
uniform ivec2 uSize;
uniform int uR;
out vec4 oColor;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy) + uSize * (1 + uR / min(uSize.x, uSize.y));
  vec4 s = vec4(0.0);
  for (int d = -uR; d <= uR; d++) s += texelFetch(tSrc, (q + d * uAxis) % uSize, 0);
  oColor = s / float(2 * uR + 1);
}
`;

/**
 * Colour rarity at both radii at once: the kernel density of the pixel's blurred colour among the samples' outside its
 * own neighbourhood, as −log. Written into the atlas at uOrigin.
 */
const RARITY = /* glsl */ `
uniform sampler2D tBlur0;
uniform sampler2D tBlur1;
uniform sampler2D tSamples;
uniform int uM;
uniform vec2 uSize;
uniform ivec2 uOrigin;
uniform float uExclude;
uniform float uInv;
uniform float uCut;
out vec4 oColor;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy) - uOrigin;
  vec3 c0 = texelFetch(tBlur0, q, 0).xyz;
  vec3 c1 = texelFetch(tBlur1, q, 0).xyz;
  vec2 p = vec2(0.0);
  float count = 0.0;
  for (int j = 0; j < uM; j++) {
    vec2 s = texelFetch(tSamples, ivec2(j, 0), 0).xy;
    vec2 d = abs(s - vec2(q));
    d = min(d, uSize - d);
    if (!(d.x < uExclude && d.y < uExclude)) {
      count += 1.0;
      ivec2 si = ivec2(s);
      vec3 e0 = c0 - texelFetch(tBlur0, si, 0).xyz;
      vec3 e1 = c1 - texelFetch(tBlur1, si, 0).xyz;
      vec2 dd = vec2(dot(e0, e0), dot(e1, e1));
      p += mix(vec2(0.0), exp(-dd * uInv), lessThan(dd, vec2(uCut)));
    }
  }
  oColor = vec4(-log(p / max(count, 1.0) + 1e-6), 0.0, 0.0);
}
`;

/**
 * Line sums, four directions per atlas block (block b at x = b · width holds directions 4b … 4b + 3): the signed
 * gradient across each direction, bilinear (by hand: hardware filtering has 8-bit weights), summed over 2 · uHalf + 1
 * taps along it.
 */
const LINES = /* glsl */ `
uniform sampler2D tGrad;
uniform vec2 uDirs[16];
uniform int uHalf;
uniform ivec2 uSize;
out vec4 oColor;
vec2 gradAt(vec2 p) {
  vec2 p0 = floor(p);
  vec2 f = p - p0;
  ivec2 i0 = ivec2(p0) + uSize * (1 + uHalf / min(uSize.x, uSize.y));
  ivec2 a = i0 % uSize;
  ivec2 b = (i0 + 1) % uSize;
  vec2 g00 = texelFetch(tGrad, a, 0).xy;
  vec2 g10 = texelFetch(tGrad, ivec2(b.x, a.y), 0).xy;
  vec2 g01 = texelFetch(tGrad, ivec2(a.x, b.y), 0).xy;
  vec2 g11 = texelFetch(tGrad, b, 0).xy;
  return mix(mix(g00, g10, f.x), mix(g01, g11, f.x), f.y);
}
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int block = q.x / uSize.x;
  vec2 o = vec2(q.x - block * uSize.x, q.y);
  vec4 s = vec4(0.0);
  for (int t = 0; t < 4 * (2 * uHalf + 1); t++) {
    int j = t / (2 * uHalf + 1);
    float k = float(t - j * (2 * uHalf + 1) - uHalf);
    vec2 dir = uDirs[4 * block + j];
    vec2 g = gradAt(o + k * dir);
    float across = g.y * dir.x - g.x * dir.y;
    s += across * vec4(equal(ivec4(j), ivec4(0, 1, 2, 3)));
  }
  oColor = s;
}
`;

/** (L, a, b, density) into the atlas at uOrigin. */
const PACK = /* glsl */ `
uniform sampler2D tLab;
uniform sampler2D tGrad;
uniform ivec2 uOrigin;
out vec4 oColor;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy) - uOrigin;
  oColor = vec4(texelFetch(tLab, q, 0).xyz, texelFetch(tGrad, q, 0).z);
}
`;

/** Atlas blocks (each work width wide): 0–3 line sums, 4 lab + density, 5 rarity. */
const LAB_BLOCK = 4;
const RARITY_BLOCK = 5;
const BLOCKS = 6;

class TilingGpu implements TilingKernelSource {
	private readonly gpu: Gpu;
	private readonly pool: ScratchPool;
	private readonly down: THREE.RawShaderMaterial;
	private readonly sobel: THREE.RawShaderMaterial;
	private readonly blur: THREE.RawShaderMaterial;
	private readonly rarity: THREE.RawShaderMaterial;
	private readonly lines: THREE.RawShaderMaterial;
	private readonly pack: THREE.RawShaderMaterial;
	private input: THREE.DataTexture | null = null;
	private samples: { key: string; tex: THREE.DataTexture } | null = null;

	constructor(gpu: Gpu) {
		this.gpu = gpu;
		this.pool = new ScratchPool(gpu);
		const u = (names: string[]) =>
			Object.fromEntries(names.map((n) => [n, { value: null }])) as THREE.ShaderMaterial['uniforms'];
		this.down = gpu.material(DOWN, u(['tSrc', 'uAxis', 'uScale', 'uTaps', 'uSrcLen', 'uFirst']));
		this.sobel = gpu.material(SOBEL, u(['tLab', 'uSize']));
		this.blur = gpu.material(BLUR, u(['tSrc', 'uAxis', 'uSize', 'uR']));
		this.rarity = gpu.material(
			RARITY,
			u(['tBlur0', 'tBlur1', 'tSamples', 'uM', 'uSize', 'uOrigin', 'uExclude', 'uInv', 'uCut'])
		);
		this.lines = gpu.material(LINES, u(['tGrad', 'uDirs', 'uHalf', 'uSize']));
		this.pack = gpu.material(PACK, u(['tLab', 'tGrad', 'uOrigin']));
	}

	kernels(img: MatchImage, w: number, h: number): TilingKernels {
		const { gpu, pool } = this;
		const geo = tilingGeometry(w, h);
		if (geo.radii.length !== 2 || geo.dirs.length !== 16) throw new Error('tiling gpu: kernel layout changed');
		const size = new THREE.Vector2(w, h);
		const isize = (x: number, y: number) => new THREE.Vector2(x, y);
		const set = (m: THREE.RawShaderMaterial, values: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(values)) m.uniforms[k].value = v;
		};

		// The render, as it is (rows top-down: texel row y is image row y throughout, no flips).
		if (!this.input || this.input.image.width !== img.width || this.input.image.height !== img.height) {
			this.input?.dispose();
			this.input = floatTexture(img.data, img.width, img.height);
		} else {
			this.input.image.data = img.data;
			this.input.needsUpdate = true;
		}

		// Box down to the work size, x then y, ending in OKLab.
		const tmp = pool.get('down', w, img.height);
		const lab = pool.get('lab', w, h);
		const down = (src: THREE.Texture, axis: THREE.Vector2, srcLen: number, dstLen: number, first: boolean) => {
			const scale = srcLen / dstLen;
			set(this.down, {
				tSrc: src,
				uAxis: axis,
				uScale: scale,
				uTaps: Math.ceil(scale) + 1,
				uSrcLen: srcLen,
				uFirst: first
			});
		};
		down(this.input, isize(1, 0), img.width, w, true);
		gpu.run(this.down, tmp);
		down(tmp.texture, isize(0, 1), img.height, h, false);
		gpu.run(this.down, lab);

		const grad = pool.get('grad', w, h);
		set(this.sobel, { tLab: lab.texture, uSize: isize(w, h) });
		gpu.run(this.sobel, grad);

		// The colour blurred at each radius: a box along x, then y, twice.
		const blurred = geo.radii.map((r, k) => {
			const a = pool.get(`blurA${k}`, w, h);
			const b = pool.get(`blurB${k}`, w, h);
			let src = lab.texture;
			for (let pass = 0; pass < 2; pass++) {
				set(this.blur, { tSrc: src, uAxis: isize(1, 0), uSize: isize(w, h), uR: r });
				gpu.run(this.blur, a);
				set(this.blur, { tSrc: a.texture, uAxis: isize(0, 1) });
				gpu.run(this.blur, b);
				src = b.texture;
			}
			return b.texture;
		});

		const atlas = pool.get('atlas', w * BLOCKS, h);
		// Into a block of the atlas.
		const into = (m: THREE.RawShaderMaterial, block: number, blocks: number) =>
			gpu.run(m, atlas, { x: block * w, y: 0, w: blocks * w, h });
		set(this.rarity, {
			tBlur0: blurred[0],
			tBlur1: blurred[1],
			tSamples: this.sampleTexture(w, h, geo.samples),
			uM: geo.samples.length,
			uSize: size,
			uOrigin: isize(RARITY_BLOCK * w, 0),
			uExclude: geo.exclude,
			uInv: 1 / (2 * RARITY_KERNEL * RARITY_KERNEL),
			uCut: 9 * RARITY_KERNEL * RARITY_KERNEL
		});
		into(this.rarity, RARITY_BLOCK, 1);
		set(this.lines, {
			tGrad: grad.texture,
			uDirs: geo.dirs.map(([x, y]) => new THREE.Vector2(x, y)),
			uHalf: geo.half,
			uSize: isize(w, h)
		});
		into(this.lines, 0, 4);
		set(this.pack, { tLab: lab.texture, tGrad: grad.texture, uOrigin: isize(LAB_BLOCK * w, 0) });
		into(this.pack, LAB_BLOCK, 1);

		const W = w * BLOCKS;
		const px = new Float32Array(W * h * 4);
		gpu.renderer.readRenderTargetPixels(atlas, 0, 0, W, h, px);
		const plane = (block: number, channel: number) => {
			const out = new Float32Array(w * h);
			for (let y = 0; y < h; y++) {
				const row = (y * W + block * w) * 4 + channel;
				for (let x = 0; x < w; x++) out[y * w + x] = px[row + x * 4];
			}
			return out;
		};
		const n = w * h;
		return {
			lab: {
				width: w,
				height: h,
				L: plane(LAB_BLOCK, 0),
				A: plane(LAB_BLOCK, 1),
				B: plane(LAB_BLOCK, 2),
				alpha: new Float32Array(n).fill(1)
			},
			density: plane(LAB_BLOCK, 3),
			rarity: [plane(RARITY_BLOCK, 0), plane(RARITY_BLOCK, 1)],
			lineSums: geo.dirs.map((_, k) => plane(k >> 2, k & 3))
		};
	}

	/** The rarity samples' positions (x, y), one texel each. */
	private sampleTexture(w: number, h: number, samples: Int32Array): THREE.DataTexture {
		const key = `${w}x${h}`;
		if (this.samples?.key === key) return this.samples.tex;
		this.samples?.tex.dispose();
		const data = new Float32Array(samples.length * 4);
		samples.forEach((j, k) => {
			data[k * 4] = j % w;
			data[k * 4 + 1] = Math.floor(j / w);
		});
		this.samples = { key, tex: floatTexture(data, samples.length, 1) };
		return this.samples.tex;
	}
}

function floatTexture(data: Float32Array, width: number, height: number): THREE.DataTexture {
	const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
	t.minFilter = THREE.NearestFilter;
	t.magFilter = THREE.NearestFilter;
	t.colorSpace = THREE.NoColorSpace;
	t.needsUpdate = true;
	return t;
}

/** Largest differences between two sets of kernels (and how many pixels differ by more than `tol` of a kernel's span). */
export function compareKernels(
	a: TilingKernels,
	b: TilingKernels,
	tol = 1e-3
): Record<string, { max: number; over: number }> {
	const cmp = (x: Float32Array[], y: Float32Array[]) => {
		let span = 1e-9;
		for (const v of x) for (let i = 0; i < v.length; i++) span = Math.max(span, Math.abs(v[i]));
		let max = 0;
		let over = 0;
		x.forEach((v, k) => {
			for (let i = 0; i < v.length; i++) {
				const d = Math.abs(v[i] - y[k][i]) / span;
				max = Math.max(max, Number.isNaN(d) ? Infinity : d);
				if (!(d <= tol)) over++;
			}
		});
		return { max, over };
	};
	return {
		lab: cmp([a.lab.L, a.lab.A, a.lab.B], [b.lab.L, b.lab.A, b.lab.B]),
		density: cmp([a.density], [b.density]),
		rarity: cmp(a.rarity, b.rarity),
		lineSums: cmp(a.lineSums, b.lineSums)
	};
}

/**
 * The GPU analysis against the CPU reference on one image: kernels (relative to each one's largest value) and the
 * analysis' score and terms.
 */
export function checkTilingGpu(k: TilingKernelSource, img: MatchImage) {
	const [w, h] = workSize(img.width, img.height);
	const gpuK = k.kernels(img, w, h);
	const cpuK = tilingKernels(workLab(img, w, h));
	if (!gpuK) return null;
	const g = finishAnalysis(gpuK);
	const c = finishAnalysis(cpuK);
	return {
		kernels: compareKernels(gpuK, cpuK),
		score: { gpu: g.score, cpu: c.score },
		terms: Object.fromEntries(TILING_TERMS.map((t) => [t, { gpu: g.terms[t], cpu: c.terms[t] }]))
	};
}

/** A test card for the self-check: dots, a blob, a crease and a gradient on a non-square tile, with transparency. */
function testCard(): MatchImage {
	const W = 72;
	const H = 52;
	const data = new Float32Array(W * H * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			let v = 0.55 + 0.1 * Math.sin(x * 0.7) * Math.cos(y * 1.3) + (0.15 * x) / W;
			if ((x * 7 + y * 13) % 17 < 3) v -= 0.25;
			if (Math.hypot(x - 20, y - 30) < 8) v = 0.1;
			if (Math.abs(x - y - 10) < 1 && y > 5 && y < 40) v = 0.9;
			const i = (y * W + x) * 4;
			data[i] = v;
			data[i + 1] = v * 0.8 + 0.1;
			data[i + 2] = 1 - v;
			data[i + 3] = x < 4 ? 0.5 : 1;
		}
	return { width: W, height: H, data };
}

const cache = new WeakMap<Gpu, TilingKernelSource | null>();

/**
 * The GPU kernels for `gpu`, checked once against the CPU on a test card: null (use the CPU) when the GPU can't run
 * them or gets a different answer — a shader that failed to compile renders nothing, without an error.
 */
export function tilingGpu(gpu: Gpu | null | undefined): TilingKernelSource | null {
	if (!gpu) return null;
	if (cache.has(gpu)) return cache.get(gpu)!;
	let k: TilingKernelSource | null = null;
	try {
		const t = new TilingGpu(gpu);
		const card = testCard();
		const check = checkTilingGpu(t, card);
		const bad = check && Object.entries(check.kernels).find(([, v]) => !(v.max < 0.02 && v.over < 8));
		if (!check || bad || !(Math.abs(check.score.gpu - check.score.cpu) < 0.002))
			console.warn('tiling: GPU analysis disagrees with the CPU, using the CPU:', JSON.stringify(check));
		else k = t;
	} catch (e) {
		console.warn('tiling: GPU analysis unavailable, using the CPU:', e instanceof Error ? e.message : e);
	}
	cache.set(gpu, k);
	return k;
}
