// Texture statistics from VGG-19 on the GPU (docs/features/fr8.1-texture-metric.md): Gram matrices of the
// conv1_1, conv2_1, conv3_1 and conv4_1 activations — the shift-invariant texture descriptor of neural texture
// synthesis (Gatys et al. 2015). Unlike the pixel-aligned structure term it sees "irregular stone courses" vs
// "marble veining" without the layouts having to line up.
//
//   const net = await TextureNet.load(gpu)
//   matcher.texture = net.scorer(matcher.target, wrap)    // → the metric's `texture` term
//
// Feature maps are float textures of `width × slices` by `height` texels: 4 channels per texel, the channel slices
// side by side. Each conv layer is one pass with constant loop bounds; weights are mat4s (4 in → 4 out channels per
// tap) in an RGBA float texture. Gram matrices stay on the GPU; only a per-row reduction of |G − G_target|² is read
// back. Weights: public/models/vgg19-conv4_1.{bin,json} (VGG-19, Oxford VGG, CC BY 4.0; fp16).

import * as THREE from 'three';
import type { Gpu } from '@/gpu/context';
import type { MatchImage } from './image';
import { argsortFloat32, sortFloat32 } from './quantiles';

interface LayerSpec {
	name: string;
	cin: number;
	cout: number;
	/** Offsets (in values) of the weights (kh, kw, cin, cout) and the bias in the blob. */
	w: number;
	b: number;
}

interface Manifest {
	values: number;
	layers: LayerSpec[];
	pool_after: string[];
	taps: string[];
}

/** Bound to a target: distance of a render's texture statistics to the target's (0 = identical). */
export interface TextureScorer {
	distance(render: MatchImage): number;
	/**
	 * distance() in two halves: runs the network on the GPU and returns a function that reads the result back (and
	 * waits for the GPU only then), so the CPU can do other work meanwhile. Call the function before the next submit.
	 */
	submit(render: MatchImage): () => number;
	/** Free the GPU targets holding the reference's statistics (also done once the scorer is garbage-collected). */
	dispose(): void;
}

/** Safety net for scorers dropped without dispose(): their targets are freed when the scorer is collected. */
const orphanTargets = new FinalizationRegistry<THREE.WebGLRenderTarget[]>((targets) => {
	for (const t of targets) t.dispose();
});

const WTEX = 4096;
const MEAN_BGR = [103.939, 116.779, 123.68];

const CONV = /* glsl */ `
uniform sampler2D tIn;
uniform sampler2D tW;
uniform sampler2D tB;
uniform ivec2 uSize;
uniform bool uWrap;
out vec4 oColor;
ivec2 wt(int i) { return ivec2(i % ${WTEX}, i / ${WTEX}); }
int edge(int v, int n) {
  if (uWrap) return (v + n) % n;
  return v < 0 ? -v : v >= n ? 2 * n - 2 - v : v;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int so = p.x / uSize.x;
  int x = p.x - so * uSize.x;
  vec4 acc = texelFetch(tB, ivec2(so, 0), 0);
  for (int t = 0; t < 9; t++) {
    int xx = edge(x + t % 3 - 1, uSize.x);
    int yy = edge(p.y + t / 3 - 1, uSize.y);
    for (int si = 0; si < SIN; si++) {
      vec4 v = texelFetch(tIn, ivec2(si * uSize.x + xx, yy), 0);
      int base = ((so * SIN + si) * 9 + t) * 4;
      acc += mat4(texelFetch(tW, wt(base), 0), texelFetch(tW, wt(base + 1), 0), texelFetch(tW, wt(base + 2), 0), texelFetch(tW, wt(base + 3), 0)) * v;
    }
  }
  oColor = max(acc, 0.0);
}
`;

const POOL = /* glsl */ `
uniform sampler2D tIn;
uniform ivec2 uSize; // output map size
out vec4 oColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int s = p.x / uSize.x;
  int x = p.x - s * uSize.x;
  int W = uSize.x * 2;
  ivec2 q = ivec2(s * W + 2 * x, 2 * p.y);
  oColor = max(max(texelFetch(tIn, q, 0), texelFetch(tIn, q + ivec2(1, 0), 0)), max(texelFetch(tIn, q + ivec2(0, 1), 0), texelFetch(tIn, q + ivec2(1, 1), 0)));
}
`;

// Gram: texel (a, j) = Σ_n F_slice(a)(n) · F_j(n) / N — rows j of 4 entries.
const GRAM = /* glsl */ `
uniform sampler2D tIn;
uniform ivec2 uSize;
out vec4 oColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int a = p.x;
  int j = p.y;
  int sj = j / 4;
  int cj = j - sj * 4;
  vec4 acc = vec4(0.0);
  for (int y = 0; y < uSize.y; y++)
    for (int x = 0; x < uSize.x; x++) {
      vec4 fa = texelFetch(tIn, ivec2(a * uSize.x + x, y), 0);
      vec4 fj = texelFetch(tIn, ivec2(sj * uSize.x + x, y), 0);
      acc += fa * fj[cj];
    }
  oColor = acc / float(uSize.x * uSize.y);
}
`;

// Per Gram row j: (Σ |A − B|², Σ A², Σ B²) over the row's slices.
const REDUCE = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tB;
uniform int uSlices;
out vec4 oColor;
void main() {
  int j = int(gl_FragCoord.x);
  vec3 s = vec3(0.0);
  for (int a = 0; a < uSlices; a++) {
    vec4 x = texelFetch(tA, ivec2(a, j), 0);
    vec4 y = texelFetch(tB, ivec2(a, j), 0);
    vec4 d = x - y;
    s += vec3(dot(d, d), dot(x, x), dot(y, y));
  }
  oColor = vec4(s, 1.0);
}
`;

function halfToFloat(h: number): number {
	const s = h & 0x8000 ? -1 : 1;
	const e = (h >> 10) & 0x1f;
	const f = h & 0x3ff;
	if (e === 0) return s * 2 ** -14 * (f / 1024);
	if (e === 31) return f ? NaN : s * Infinity;
	return s * 2 ** (e - 15) * (1 + f / 1024);
}

function floatTexture(data: Float32Array, width: number, height: number): THREE.DataTexture {
	const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
	t.minFilter = THREE.NearestFilter;
	t.magFilter = THREE.NearestFilter;
	t.colorSpace = THREE.NoColorSpace;
	t.needsUpdate = true;
	return t;
}

/** Each reference's channels sorted (references are fixed: a scorer's target). */
const sortedChannels = new WeakMap<MatchImage, Float32Array[]>();

/**
 * Per-channel histogram matching of `src` to `ref` (same size): keeps the arrangement, takes the colours. `ref` must not
 * change afterwards: its sorted channels are kept for the next call.
 */
export function matchHistogram(src: MatchImage, ref: MatchImage): MatchImage {
	const n = src.width * src.height;
	let sorted = sortedChannels.get(ref);
	if (!sorted) {
		sorted = [0, 1, 2].map((c) => sortFloat32(Float32Array.from({ length: n }, (_, i) => ref.data[i * 4 + c])));
		sortedChannels.set(ref, sorted);
	}
	const out = new Float32Array(src.data);
	const channel = new Float32Array(n);
	for (let c = 0; c < 3; c++) {
		for (let i = 0; i < n; i++) channel[i] = src.data[i * 4 + c];
		const order = argsortFloat32(channel);
		const s = sorted[c];
		for (let r = 0; r < n; r++) out[order[r] * 4 + c] = s[r];
	}
	return { width: src.width, height: src.height, data: out };
}

interface Layer {
	spec: LayerSpec;
	sin: number;
	sout: number;
	weights: THREE.DataTexture;
	bias: THREE.DataTexture;
	mat: THREE.RawShaderMaterial;
	pool: boolean;
	tap: boolean;
}

interface Run {
	width: number;
	height: number;
	outs: THREE.WebGLRenderTarget[];
	pools: (THREE.WebGLRenderTarget | null)[];
	grams: THREE.WebGLRenderTarget[];
	reduce: THREE.WebGLRenderTarget;
}

let loading: Promise<{ manifest: Manifest; values: Float32Array }> | null = null;

async function fetchWeights(base: string): Promise<{ manifest: Manifest; values: Float32Array }> {
	const manifest = (await (await fetch(`${base}.json`)).json()) as Manifest;
	const buf = await (await fetch(`${base}.bin`)).arrayBuffer();
	const half = new Uint16Array(buf);
	if (half.length !== manifest.values)
		throw new Error(`VGG weights: expected ${manifest.values} values, got ${half.length}`);
	const lut = new Float32Array(65536);
	for (let i = 0; i < 65536; i++) lut[i] = halfToFloat(i);
	const values = new Float32Array(half.length);
	for (let i = 0; i < half.length; i++) values[i] = lut[half[i]];
	return { manifest, values };
}

const nets = new WeakMap<Gpu, Promise<TextureNet>>();

export class TextureNet {
	private readonly layers: Layer[];
	private readonly poolMat: THREE.RawShaderMaterial;
	private readonly gramMat: THREE.RawShaderMaterial;
	private readonly reduceMat: THREE.RawShaderMaterial;
	private readonly runs = new Map<string, Run>();
	private readonly taps: number;

	/** Load (once per GPU context) the weights from `public/models`. */
	static load(
		gpu: Gpu,
		base = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}models/vgg19-conv4_1`
	): Promise<TextureNet> {
		let p = nets.get(gpu);
		if (!p) {
			loading ??= fetchWeights(base);
			p = loading.then(({ manifest, values }) => new TextureNet(gpu, manifest, values));
			nets.set(gpu, p);
		}
		return p;
	}

	private constructor(
		private readonly gpu: Gpu,
		manifest: Manifest,
		values: Float32Array
	) {
		this.layers = manifest.layers.map((spec) => {
			const sin = Math.ceil(spec.cin / 4);
			const sout = spec.cout / 4;
			// mat4 per (so, si, tap): column k = input channel 4·si + k → output channels 4·so … 4·so + 3.
			const count = sout * sin * 9 * 4;
			const rows = Math.ceil(count / WTEX);
			const w = new Float32Array(WTEX * rows * 4);
			for (let so = 0; so < sout; so++)
				for (let si = 0; si < sin; si++)
					for (let t = 0; t < 9; t++)
						for (let k = 0; k < 4; k++) {
							const ci = si * 4 + k;
							if (ci >= spec.cin) continue;
							const texel = ((so * sin + si) * 9 + t) * 4 + k;
							const kh = Math.floor(t / 3);
							const kw = t % 3;
							for (let o = 0; o < 4; o++)
								w[texel * 4 + o] = values[spec.w + ((kh * 3 + kw) * spec.cin + ci) * spec.cout + so * 4 + o];
						}
			const b = new Float32Array(sout * 4);
			for (let i = 0; i < spec.cout; i++) b[i] = values[spec.b + i];
			const mat = gpu.material(`#define SIN ${sin}\n` + CONV, {
				tIn: { value: null },
				tW: { value: null },
				tB: { value: null },
				uSize: { value: new THREE.Vector2() },
				uWrap: { value: true }
			});
			return {
				spec,
				sin,
				sout,
				weights: floatTexture(w, WTEX, rows),
				bias: floatTexture(b, sout, 1),
				mat,
				pool: manifest.pool_after.includes(spec.name),
				tap: manifest.taps.includes(spec.name)
			};
		});
		this.taps = this.layers.filter((l) => l.tap).length;
		this.poolMat = gpu.material(POOL, { tIn: { value: null }, uSize: { value: new THREE.Vector2() } });
		this.gramMat = gpu.material(GRAM, { tIn: { value: null }, uSize: { value: new THREE.Vector2() } });
		this.reduceMat = gpu.material(REDUCE, { tA: { value: null }, tB: { value: null }, uSlices: { value: 1 } });
	}

	/** Render targets for one input size (cached). */
	private run(width: number, height: number): Run {
		const key = `${width}x${height}`;
		let r = this.runs.get(key);
		if (r) return r;
		const gpu = this.gpu;
		const outs: THREE.WebGLRenderTarget[] = [];
		const pools: (THREE.WebGLRenderTarget | null)[] = [];
		const grams: THREE.WebGLRenderTarget[] = [];
		let w = width;
		let h = height;
		for (const l of this.layers) {
			outs.push(gpu.target(w * l.sout, h));
			if (l.tap) grams.push(gpu.target(l.sout, l.spec.cout));
			if (l.pool) {
				w = Math.max(1, w >> 1);
				h = Math.max(1, h >> 1);
				pools.push(gpu.target(w * l.sout, h));
			} else pools.push(null);
		}
		const maxC = Math.max(...this.layers.filter((l) => l.tap).map((l) => l.spec.cout));
		r = { width, height, outs, pools, grams, reduce: gpu.target(maxC, this.taps) };
		this.runs.set(key, r);
		return r;
	}

	/** Run the network on `img` into the size's Gram targets (or into `into`, e.g. a scorer's own targets). */
	private gramsOf(img: MatchImage, wrap: boolean, into?: THREE.WebGLRenderTarget[]): THREE.WebGLRenderTarget[] {
		const r = this.run(img.width, img.height);
		const n = img.width * img.height;
		const px = new Float32Array(n * 4);
		for (let i = 0; i < n; i++) {
			// sRGB 0..1 → BGR 0..255 minus the ImageNet mean (Caffe VGG preprocessing).
			px[i * 4] = img.data[i * 4 + 2] * 255 - MEAN_BGR[0];
			px[i * 4 + 1] = img.data[i * 4 + 1] * 255 - MEAN_BGR[1];
			px[i * 4 + 2] = img.data[i * 4] * 255 - MEAN_BGR[2];
		}
		const tex = floatTexture(px, img.width, img.height);
		const grams = into ?? r.grams;
		let src: THREE.Texture = tex;
		let w = img.width;
		let h = img.height;
		let g = 0;
		this.layers.forEach((l, i) => {
			const m = l.mat;
			m.uniforms.tIn.value = src;
			m.uniforms.tW.value = l.weights;
			m.uniforms.tB.value = l.bias;
			m.uniforms.uSize.value.set(w, h);
			m.uniforms.uWrap.value = wrap;
			this.gpu.run(m, r.outs[i]);
			src = r.outs[i].texture;
			if (l.tap) {
				this.gramMat.uniforms.tIn.value = src;
				this.gramMat.uniforms.uSize.value.set(w, h);
				this.gpu.run(this.gramMat, grams[g++]);
			}
			if (l.pool) {
				w = Math.max(1, w >> 1);
				h = Math.max(1, h >> 1);
				this.poolMat.uniforms.tIn.value = src;
				this.poolMat.uniforms.uSize.value.set(w, h);
				this.gpu.run(this.poolMat, r.pools[i]!);
				src = r.pools[i]!.texture;
			}
		});
		tex.dispose();
		return grams;
	}

	/** Mean over the taps of ‖G − G_target‖ / (‖G‖ + ‖G_target‖), 0..1: submitted, then read back when the result is called. */
	private distanceTo(img: MatchImage, wrap: boolean, target: THREE.WebGLRenderTarget[]): () => number {
		const grams = this.gramsOf(img, wrap);
		const r = this.run(img.width, img.height);
		const taps = this.layers.filter((l) => l.tap);
		taps.forEach((l, t) => {
			const m = this.reduceMat;
			m.uniforms.tA.value = grams[t].texture;
			m.uniforms.tB.value = target[t].texture;
			m.uniforms.uSlices.value = l.sout;
			this.gpu.run(m, r.reduce, { x: 0, y: t, w: l.spec.cout, h: 1 });
		});
		return () => {
			const out = this.gpu.readTexture(r.reduce.texture, r.reduce.width, r.reduce.height);
			let sum = 0;
			taps.forEach((l, t) => {
				let d = 0;
				let a = 0;
				let b = 0;
				for (let j = 0; j < l.spec.cout; j++) {
					const o = (t * r.reduce.width + j) * 4;
					d += out[o];
					a += out[o + 1];
					b += out[o + 2];
				}
				sum += Math.sqrt(d) / (Math.sqrt(a) + Math.sqrt(b) + 1e-9);
			});
			return sum / taps.length;
		};
	}

	/**
	 * A scorer for `target`: renders are histogram-matched to the target's colours first, so the distance measures
	 * texture (shapes, scales, edges) and leaves colour to the colour term.
	 */
	scorer(target: MatchImage, wrap: boolean): TextureScorer {
		const own = this.layers.filter((l) => l.tap).map((l) => this.gpu.target(l.sout, l.spec.cout));
		this.gramsOf(target, wrap, own);
		let alive = true;
		const scorer: TextureScorer = {
			distance: (render: MatchImage) => scorer.submit(render)(),
			submit: (render: MatchImage) => {
				if (!alive) throw new Error('TextureScorer: disposed');
				if (render.width !== target.width || render.height !== target.height)
					throw new Error('TextureScorer: size mismatch');
				return this.distanceTo(matchHistogram(render, target), wrap, own);
			},
			dispose: () => {
				if (!alive) return;
				alive = false;
				orphanTargets.unregister(scorer);
				for (const t of own) t.dispose();
			}
		};
		orphanTargets.register(scorer, own, scorer);
		return scorer;
	}

	/** Texture distance of two images of the same size (no colour matching), for tests and tools. */
	compare(a: MatchImage, b: MatchImage, wrap: boolean): number {
		const own = this.layers.filter((l) => l.tap).map((l) => this.gpu.target(l.sout, l.spec.cout));
		this.gramsOf(b, wrap, own);
		const d = this.distanceTo(a, wrap, own)();
		for (const t of own) t.dispose();
		return d;
	}
}
