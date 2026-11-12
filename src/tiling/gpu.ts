// The tiling analysis' per-pixel kernels on the GPU (docs/features/fr9-tiling-workspace.md): the render box-filtered to
// the work size and turned into OKLab, its Sobel gradient, the blurs and colour rarity, and the line sums — the same
// arithmetic as `tilingKernels` in analyze.ts (the reference), ≈1000 × faster than it on the CPU. Everything after
// them (medians, quantiles, the low band, the scores) stays on the CPU, from one readback.
//
// It also makes the evaluation's frames (`frame`): the engine's output box-filtered to frameSize in linear light,
// premultiplied, flipped to rows top-down — read back (≤ 4 MB) only when the CPU needs it; the kernels read it in place.
//
// Every loop's bound is a uniform (D3D can't unroll it) and nothing uses `continue` (ANGLE / D3D11 can miscompile it,
// AGENTS.md). Wrapping uses texelFetch with integer indices, made positive before `%` (negative `%` is undefined).
//
//   const k = tilingGpu(engine.gpu)          // null when the GPU's result doesn't match the CPU's (then use the CPU)
//   analyzeTiling(k.frame(engine.finalTexture(), w, h), opts, k)

import * as THREE from 'three';
import { ScratchPool, type Gpu } from '@/gpu/context';
import { GLSL_COLOUR } from '@/layers/glsl/common';
import { linearPremul, resamplePremul, type LabPlanes, type LinearPremul } from '@/match/image';
import {
	TILING_TERMS,
	TilingFrame,
	finishAnalysis,
	frameSize,
	tilingGeometry,
	tilingKernels,
	workLab,
	workSize,
	type TilingKernelSource,
	type TilingKernels
} from './analyze';

/**
 * Box filter along one axis (area average, as match/image.ts' resample 'box'): output texel i covers source
 * [i · uScale, (i + 1) · uScale). The source is premultiplied linear (uStraight: straight linear, clamped 0..1 as
 * fromLinear clamps it, and premultiplied first; uFlip: its rows bottom-up, as the engine's are, read flipped). uLab
 * ends in OKLab over mid grey (toOklab's background) with alpha in w; else premultiplied linear.
 */
const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform ivec2 uAxis;
uniform float uScale;
uniform int uTaps;
uniform int uSrcLen;
uniform bool uStraight;
uniform bool uFlip;
uniform int uSrcH;
uniform bool uLab;
out vec4 oColor;
${GLSL_COLOUR}
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
    if (uFlip) p.y = uSrcH - 1 - p.y;
    vec4 c = texelFetch(tSrc, p, 0);
    if (uStraight) {
      c = clamp(c, 0.0, 1.0);
      c.rgb *= c.a;
    }
    sum += w * c;
    wsum += w;
  }
  sum /= max(wsum, 1e-12);
  if (!uLab) { oColor = sum; return; }
  float al = clamp(sum.a, 0.0, 1.0);
  vec3 rgb = clamp(sum.rgb * (sum.a > 1e-6 ? 1.0 / sum.a : 0.0), 0.0, 1.0);
  rgb = mix(vec3(0.2140411405), rgb, al); // mid grey (sRGB 0.5) in linear light
  oColor = vec4(linearToOklab(rgb), al);
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

/** The GPU kernels, and the frames they read in place. */
export interface TilingGpu extends TilingKernelSource {
	/**
	 * The engine's output texture (`src`: W × H texels, linear, straight alpha, rows bottom-up) as a frame at `size`
	 * (default frameSize). `lazy`: its pixels are read back only when `lin` is first read, which must be before the
	 * next frame is made (it throws otherwise).
	 */
	frame(src: THREE.Texture, W: number, H: number, opts?: { size?: [number, number]; lazy?: boolean }): TilingFrame;
	/** Free the targets and textures sized for the last analysis (made again on demand). */
	release(): void;
	/** release() and free the shaders: the GPU kernels for this context are made again by tilingGpu. */
	dispose(): void;
}

class Kernels implements TilingGpu {
	private readonly gpu: Gpu;
	private readonly pool: ScratchPool;
	private readonly down: THREE.RawShaderMaterial;
	private readonly sobel: THREE.RawShaderMaterial;
	private readonly blur: THREE.RawShaderMaterial;
	private readonly rarity: THREE.RawShaderMaterial;
	private readonly lines: THREE.RawShaderMaterial;
	private readonly pack: THREE.RawShaderMaterial;
	private samples: { key: string; tex: THREE.DataTexture } | null = null;
	/** Counts the frames made: a frame's pixels are in the 'frame' target while its number is the last. */
	private generation = 0;
	private readonly frames = new WeakMap<TilingFrame, number>();

	constructor(gpu: Gpu) {
		this.gpu = gpu;
		this.pool = new ScratchPool(gpu);
		const u = (names: string[]) =>
			Object.fromEntries(names.map((n) => [n, { value: null }])) as THREE.ShaderMaterial['uniforms'];
		this.down = gpu.material(
			DOWN,
			u(['tSrc', 'uAxis', 'uScale', 'uTaps', 'uSrcLen', 'uStraight', 'uFlip', 'uSrcH', 'uLab'])
		);
		this.sobel = gpu.material(SOBEL, u(['tLab', 'uSize']));
		this.blur = gpu.material(BLUR, u(['tSrc', 'uAxis', 'uSize', 'uR']));
		this.rarity = gpu.material(
			RARITY,
			u(['tBlur0', 'tBlur1', 'tSamples', 'uM', 'uSize', 'uOrigin', 'uExclude', 'uInv', 'uCut'])
		);
		this.lines = gpu.material(LINES, u(['tGrad', 'uDirs', 'uHalf', 'uSize']));
		this.pack = gpu.material(PACK, u(['tLab', 'tGrad', 'uOrigin']));
	}

	/** Box `src` (W × H) down to w × h into `dst`, x then y (through the target `tmp`). */
	private boxDown(
		src: THREE.Texture,
		W: number,
		H: number,
		dst: THREE.WebGLRenderTarget,
		tmp: string,
		mode: { straight?: boolean; flip?: boolean; lab?: boolean }
	): void {
		const { width: w, height: h } = dst;
		const mid = this.pool.get(tmp, w, H);
		const pass = (tex: THREE.Texture, axis: THREE.Vector2, srcLen: number, dstLen: number, first: boolean) => {
			const scale = srcLen / dstLen;
			const m = this.down.uniforms;
			m.tSrc.value = tex;
			m.uAxis.value = axis;
			m.uScale.value = scale;
			m.uTaps.value = Math.ceil(scale) + 1;
			m.uSrcLen.value = srcLen;
			m.uStraight.value = first && !!mode.straight;
			m.uFlip.value = first && !!mode.flip;
			m.uSrcH.value = H;
			m.uLab.value = !first && !!mode.lab;
			this.gpu.run(this.down, first ? mid : dst);
		};
		pass(src, new THREE.Vector2(1, 0), W, w, true);
		pass(mid.texture, new THREE.Vector2(0, 1), H, h, false);
	}

	frame(src: THREE.Texture, W: number, H: number, opts: { size?: [number, number]; lazy?: boolean } = {}): TilingFrame {
		const [w, h] = opts.size ?? frameSize(W, H);
		const target = this.pool.get('frame', w, h);
		this.boxDown(src, W, H, target, 'frameTmp', { straight: true, flip: true });
		const gen = ++this.generation;
		const read = (): LinearPremul => {
			if (gen !== this.generation) throw new Error('tiling gpu: a frame read back after the next one was made');
			const data = new Float32Array(w * h * 4);
			// Rows top-down already: texel row y is image row y (flipped by the box pass).
			this.gpu.renderer.readRenderTargetPixels(target, 0, 0, w, h, data);
			return { width: w, height: h, data };
		};
		const f = new TilingFrame(w, h, opts.lazy ? read : read());
		this.frames.set(f, gen);
		return f;
	}

	/** `frame` boxed down to w × h, ending in OKLab (L, a, b, alpha), in the pool's 'lab' target. */
	private labTarget(frame: TilingFrame, w: number, h: number): THREE.WebGLRenderTarget {
		// The frame where it is (the last one made), else uploaded (rows top-down: texel row y is image row y throughout).
		let upload: THREE.DataTexture | null = null;
		let src: THREE.Texture;
		if (this.frames.get(frame) === this.generation) src = this.pool.get('frame', frame.width, frame.height).texture;
		else src = upload = floatTexture(frame.lin.data, frame.width, frame.height);
		const lab = this.pool.get('lab', w, h);
		this.boxDown(src, frame.width, frame.height, lab, 'down', { lab: true });
		upload?.dispose();
		return lab;
	}

	lab(frame: TilingFrame, w: number, h: number): Omit<LabPlanes, 'alpha'> {
		const px = new Float32Array(w * h * 4);
		this.gpu.renderer.readRenderTargetPixels(this.labTarget(frame, w, h), 0, 0, w, h, px);
		const plane = (c: number) => Float32Array.from({ length: w * h }, (_, i) => px[i * 4 + c]);
		return { width: w, height: h, L: plane(0), A: plane(1), B: plane(2) };
	}

	kernels(frame: TilingFrame, w: number, h: number): TilingKernels {
		const { gpu, pool } = this;
		const geo = tilingGeometry(w, h);
		if (geo.radii.length !== 2 || geo.dirs.length !== 16) throw new Error('tiling gpu: kernel layout changed');
		const size = new THREE.Vector2(w, h);
		const isize = (x: number, y: number) => new THREE.Vector2(x, y);
		const set = (m: THREE.RawShaderMaterial, values: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(values)) m.uniforms[k].value = v;
		};

		// Box down to the work size, x then y, ending in OKLab.
		const lab = this.labTarget(frame, w, h);

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
			uInv: geo.inv,
			uCut: geo.cut
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
		return {
			lab: { width: w, height: h, L: plane(LAB_BLOCK, 0), A: plane(LAB_BLOCK, 1), B: plane(LAB_BLOCK, 2) },
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

	release(): void {
		this.pool.clear();
		this.samples?.tex.dispose();
		this.samples = null;
		this.generation++; // the frames' pixels are gone
	}

	dispose(): void {
		this.release();
		for (const m of [this.down, this.sobel, this.blur, this.rarity, this.lines, this.pack]) m.dispose();
		if (cache.get(this.gpu) === this) cache.delete(this.gpu);
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
 * The GPU analysis against the CPU reference on one frame, at the work size or at w × h: kernels (relative to each one's
 * largest value) and the analysis' score and terms.
 */
export function checkTilingGpu(k: TilingKernelSource, frame: TilingFrame, w?: number, h?: number) {
	[w, h] = w && h ? [w, h] : workSize(frame.width, frame.height);
	const gpuK = k.kernels(frame, w, h);
	if (!gpuK) return null;
	const cpuK = tilingKernels(workLab(frame.lin, w, h));
	const g = finishAnalysis(gpuK);
	const c = finishAnalysis(cpuK);
	return {
		kernels: compareKernels(gpuK, cpuK),
		score: { gpu: g.score, cpu: c.score },
		terms: Object.fromEntries(TILING_TERMS.map((t) => [t, { gpu: g.terms[t], cpu: c.terms[t] }]))
	};
}

/** Largest difference between two frames' pixels, relative to 1. */
function compareFrames(a: LinearPremul, b: LinearPremul): number {
	if (a.width !== b.width || a.height !== b.height) return Infinity;
	let max = 0;
	for (let i = 0; i < a.data.length; i++) {
		const d = Math.abs(a.data[i] - b.data[i]);
		max = Math.max(max, Number.isNaN(d) ? Infinity : d);
	}
	return max;
}

/**
 * A test card for the self-check, as the engine hands its output over (linear, straight alpha, HDR, rows bottom-up):
 * dots, a blob, a crease, a gradient and highlights past 1 on a non-square tile, with transparency. 128 × 96, so the
 * blur radii reach 4 and a frame or work size of half of it runs the real downsampling.
 */
function testCard(): { width: number; height: number; data: Float32Array } {
	const W = 128;
	const H = 96;
	const data = new Float32Array(W * H * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			let v = 0.3 + 0.1 * Math.sin(x * 0.7) * Math.cos(y * 1.3) + (0.15 * x) / W;
			if ((x * 7 + y * 13) % 17 < 3) v -= 0.2;
			if (Math.hypot(x - 36, y - 54) < 14) v = 0.02;
			if (Math.abs(x - y - 18) < 1.5 && y > 9 && y < 72) v = 0.9;
			if ((x * 5 + y * 3) % 41 === 0) v = 1.6;
			const i = ((H - 1 - y) * W + x) * 4;
			data[i] = v;
			data[i + 1] = v * 0.7 + 0.05;
			data[i + 2] = Math.max(0, 0.9 - v);
			data[i + 3] = x < 6 ? 0.5 : 1;
		}
	return { width: W, height: H, data };
}

/**
 * The self-check: frames of the test card at its size and at half (the downsampling, the flip and the clamp) against
 * the CPU's, and the kernels of the full frame at its work size (blur radii 2 and 4) and at half. A message saying what
 * disagrees, or null.
 */
function selfCheck(t: Kernels): string | null {
	const card = testCard();
	const tex = floatTexture(card.data, card.width, card.height);
	try {
		const top = new Float32Array(card.data.length);
		const row = card.width * 4;
		for (let y = 0; y < card.height; y++)
			top.set(card.data.subarray((card.height - 1 - y) * row, (card.height - y) * row), y * row);
		const cpu = linearPremul({ width: card.width, height: card.height, data: top });
		const half: [number, number] = [card.width / 2, card.height / 2];
		const small = t.frame(tex, card.width, card.height, { size: half });
		const dSmall = compareFrames(small.lin, resamplePremul(cpu, ...half, 'box'));
		const full = t.frame(tex, card.width, card.height);
		const dFull = compareFrames(full.lin, cpu);
		if (!(dSmall < 1e-5 && dFull < 1e-5)) return `frames differ by ${dFull} (full), ${dSmall} (half)`;
		for (const [w, h] of [[card.width, card.height], half]) {
			const check = checkTilingGpu(t, full, w, h);
			const bad = check && Object.entries(check.kernels).find(([, v]) => !(v.max < 0.02 && v.over < 8));
			if (!check || bad || !(Math.abs(check.score.gpu - check.score.cpu) < 0.002))
				return `kernels at ${w}×${h}: ${JSON.stringify(check)}`;
		}
		return null;
	} finally {
		tex.dispose();
		t.release();
	}
}

const cache = new WeakMap<Gpu, TilingGpu | null>();

/**
 * The GPU kernels for `gpu`, checked once against the CPU on a test card: null (use the CPU) when the GPU can't run
 * them or gets a different answer — a shader that failed to compile renders nothing, without an error.
 */
export function tilingGpu(gpu: Gpu | null | undefined): TilingGpu | null {
	if (!gpu) return null;
	if (cache.has(gpu)) return cache.get(gpu)!;
	let k: TilingGpu | null = null;
	try {
		const t = new Kernels(gpu);
		const bad = selfCheck(t);
		if (bad) {
			console.warn('tiling: GPU analysis disagrees with the CPU, using the CPU:', bad);
			t.dispose();
		} else k = t;
	} catch (e) {
		console.warn('tiling: GPU analysis unavailable, using the CPU:', e instanceof Error ? e.message : e);
	}
	cache.set(gpu, k);
	return k;
}
