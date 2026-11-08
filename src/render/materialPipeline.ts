// Stage 1 + 2 of the pipeline (docs/architecture.md §2): evaluate the layer stack into the material state
// (albedo · surface · emissive, ping-ponged MRT) and derive normals from height. Masks (FR8.23, layers/masks.ts) live
// in slot textures beside the state: a layer writes its mask's new version through the fourth output, which is copied
// into a slot when a later layer reads it.

import * as THREE from 'three';
import { hiddenByGroup, type Layer, type Project } from '@/core/project';
import { hexToLinear } from '@/core/color';
import { Gpu, PingPong, ScratchPool, type Uniforms } from '@/gpu/context';
import { createUniforms, declareUniforms, mixSeed, updateUniforms } from '@/gpu/uniforms';
import { GLSL_COMMON } from '@/layers/glsl/common';
import { GLSL_NOISE } from '@/layers/glsl/noise';
import { GLSL_SDF } from '@/layers/glsl/sdf';
import { GLSL_TRANSPARENCY } from '@/layers/glsl/transparency';
import { GLSL_BEVEL, GLSL_GENERATOR_MAIN, GLSL_MASK_OP, bevelCurveDefine, bevelCurveImpl } from '@/layers/commonParams';
import { planMasks, type LayerMasks, type MaskPlan, type MaskRef } from '@/layers/masks';
import { getLayerDef, layerParamDefs } from '@/layers/registry';
import { imagesVersion } from '@/core/images';
import type { CpuTexture, LayerCanvas, LayerDef } from '@/layers/types';
import { DerivedCache, createDerived, declareDerived, setDerived } from './derivedUniforms';

/** Declarations available to every material-stage shader. */
const STATE_DECLS = /* glsl */ `
uniform sampler2D tAlbedo;
uniform sampler2D tSurface;
uniform sampler2D tEmissive;
// The current layer's masks (FR8.23): the mask before it (its target's, or the Shape mask), its source mask, and its
// limit (a distance in .x; uLimit 0 = no limit, ±1 the sign it is read with). Mask texels: distance, random, feature.
uniform sampler2D tMaskIn;
uniform sampler2D tMaskSrc;
uniform sampler2D tLimit;
uniform float uLimit;
// Whether the source mask holds a true distance (only shapes wrote it) or a coverage, clamp(0.5 − x).
uniform bool uMaskSrcExact;
uniform float uSeed;
uniform float uDepth;
`;

/** Reading the current layer's masks (after GLSL_COMMON: fetchT wraps on tileable projects). */
/** An empty mask's distance: outside everywhere, far from any edge. */
export const MASK_EMPTY = 1e4;

const GLSL_MASKS = /* glsl */ `
float maskIn(ivec2 c) { return fetchT(tMaskIn, c).x; }
// The feature random and flag the mask before the layer records at a texel (FR8.23).
vec2 maskInFeat(ivec2 c) { return fetchT(tMaskIn, c).yz; }
// Whether a mask distance is an empty mask's (nothing written yet: outside everywhere).
bool maskEmpty(float d) { return d > ${(MASK_EMPTY * 0.5).toFixed(1)}; }
// The layer's limit as a signed distance at a texel (< 0 inside; 0 = no limit).
float limitDist(ivec2 c) { return uLimit * texelFetch(tLimit, c, 0).x; }
// How much the layer's limit lets through at a texel (1 = no limit).
float limitAt(ivec2 c) { return uLimit == 0.0 ? 1.0 : clamp(0.5 - limitDist(c), 0.0, 1.0); }
`;

// The fourth attachment carries the mask a generator writes (its target's new version), copied into a slot after the
// pass when a later layer reads it; other passes leave zeros.
const MRT_OUTS = /* glsl */ `
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oSurface;
layout(location = 2) out vec4 oEmissive;
layout(location = 3) out vec4 oMask;
`;

/** An MRT pass body that doesn't write the mask output gets zeros there (filters never write masks). */
function withMaskOut(body: string): string {
	if (body.includes('oMask')) return body;
	return (
		body.replace(/void\s+main\s*\(\s*\)/, 'void mainBody()') + '\nvoid main() { mainBody(); oMask = vec4(0.0); }\n'
	);
}

const GENOUT = /* glsl */ `
// gen() may return sdf <= NO_SDF to opt out of SDF handling for a pixel.
const float NO_SDF = -9e4;
// height: a signed height profile of the generator's own (× the Height amount), or NO_SDF for none (see genOutHeight).
// own (SDF layers): 0 the wrapper draws the shape (value = bevel, coverage = inside); 1 the generator painted its value
// and coverage itself, sdf only goes to the mask it writes (genOutOwn); 2 the generator's value × the shape's bevel,
// its own coverage (genOutShaded).
// hval: what Height › Pattern reads instead of the value (0..1, shaped like it; < 0 = the value) — Wood's grain is
// shallower in Height than in colour.
// bdist: the distance the bevel is measured in, Bevel aspect already applied (px of Bevel; NO_SDF = the shape's own
// distance, the aspect taken from its direction) — exact on boxes, whose bevels then meet in a clean mitre.
// fid: the feature's own random (0..1), which the mask it writes records (FR8.23) — rnd may be tinted or blended for
// colour, and feat zeroed where a generator varies heights itself; −1 for patterns without features.
struct GenOut { float value; float mask; float rnd; float sdf; float feat; float height; int own; float hval; float bdist; float fid; };
GenOut genOut(float value, float mask, float rnd, float sdf) { return GenOut(value, mask, rnd, sdf, 1.0, NO_SDF, 0, -1.0, NO_SDF, rnd); }
// Height › Per-feature variation's draw for a feature random: the height is scaled by 1 − variation × featVar(rnd).
// Generators that vary heights themselves (and zero feat) use it too, so they match the wrapper.
float featVar(float rnd) { return fract(rnd * 61.37 + 0.123); }
// Patterns without features (smooth noise, clouds): rnd is a continuous value there, so per-feature variation has
// nothing to vary — fract(rnd · k) would turn it into terraces along the pattern's contours.
GenOut genOutSmooth(float value, float mask, float rnd, float sdf) { return GenOut(value, mask, rnd, sdf, 0.0, NO_SDF, 0, -1.0, NO_SDF, -1.0); }
// With its own height profile, signed (below the surface < 0): Height › Pattern adds it instead of the value, wherever it
// is non-zero — not limited by the coverage, so it can reach past what the other outputs paint (a lip round a hole).
GenOut genOutHeight(float value, float mask, float rnd, float sdf, float height) { return GenOut(value, mask, rnd, sdf, 1.0, height, 0, -1.0, NO_SDF, rnd); }
// An SDF layer's output that paints its own value and coverage (chips' carve) but still hands its shape to its mask:
// the wrapper writes sdf there (by the Mode) and nowhere else.
GenOut genOutOwn(float value, float mask, float rnd, float sdf) { return GenOut(value, mask, rnd, sdf, 1.0, NO_SDF, 1, -1.0, NO_SDF, rnd); }
// A pattern on a shape (Wood's grain on its planks): the wrapper multiplies the value (and hval) by the bevel of the
// combined shape — Bevel, Profile, Bevel aspect, the mask's Mode — and keeps the generator's coverage.
GenOut genOutShaded(float value, float mask, float rnd, float sdf) { return GenOut(value, mask, rnd, sdf, 1.0, NO_SDF, 2, -1.0, NO_SDF, rnd); }
// A colour of the generator's own for Diffuse (sRGB 0..1), in place of the ramp (Stamp's image); x < 0 = the ramp.
vec3 gGenRgb = vec3(-1.0);
// A second value the Diffuse ramp blends toward, and its weight (y; 0 = none): where two features meet within a pixel
// their two colours mix, instead of the ramp positions between them (Bismuth's crystal walls). Shaped like the value.
vec2 gGenAlt = vec2(0.0);
// A brightness the Diffuse colour is multiplied by (sRGB, 1 = none): the generator's own shading of its colour, kept out
// of the value so the ramp still picks the hue (Bismuth's dark feet of its terraces).
float gGenShade = 1.0;
// How far the Diffuse colour goes grey toward its own luminance (0 = none): the generator's quieter recesses.
float gGenGrey = 0.0;
// The generator's own levels per part (LayerDef.parts), for Roughness, Specular, Metalness and Emissive with Source
// Parts: x roughness, y specular, z metalness, w emissive (0..1; < 0 = the Pattern value there).
vec4 gGenLevel = vec4(-1.0);
// Roughness, Specular, Metalness and Emissive take the whole shape for the Pattern value: the generator's value is only
// shading (a fastener head's dark socket), not a change of material.
bool gGenFillLevels = false;
// The share of the Diffuse colour it lays that is transmitted light (0..1): seen through a clear medium, not shaded by
// the surface, so carried as emission (layTransparent; Ice).
float gGenTransmit = 0.0;
${GLSL_MASK_OP}`;

/** Everything a GLSL snippet in the material stage can rely on. */
export const MATERIAL_PRELUDE = STATE_DECLS + GLSL_COMMON + GLSL_MASKS + GLSL_NOISE + GLSL_SDF + GLSL_TRANSPARENCY;

/** Masks a combined limit reads at most: a layer's own four terms and its group's four. */
const MAX_LIMIT_INPUTS = 8;

/** uMaskKind for a mask write: 0 nothing, 1 its shape (a distance), 2 its coverage. */
const maskKind = (w: { kind: string } | null | undefined) => (w ? (w.kind === 'shape' ? 1 : 2) : 0);

/** The prelude of layer-independent filter passes (FilterContext.sharedMaterial): no noise, no layer params. */
const SHARED_PRELUDE = STATE_DECLS + GLSL_COMMON + GLSL_MASKS + GLSL_SDF;

export interface FilterContext {
	gpu: Gpu;
	project: Project;
	layer: Layer;
	width: number;
	height: number;
	/** Current material state (read side). */
	readonly albedo: THREE.Texture;
	readonly surface: THREE.Texture;
	readonly emissive: THREE.Texture;
	/**
	 * The layer's source mask (LayerDef.maskSource), or null: its texture (distance in .x) and whether the distance is
	 * exact (only shapes wrote it) — else find one by jump flood from its coverage, clamp(0.5 − x).
	 */
	readonly maskSource: { texture: THREE.Texture; exact: boolean } | null;
	/** The layer's combined seed (uSeed). */
	seed: number;
	/**
	 * An MRT material (writes oAlbedo/oSurface/oEmissive). `body` is GLSL appended after the prelude, the
	 * layer's u_<param> uniforms and the MRT outputs; it must define main(). Cached by key.
	 */
	mrtMaterial(key: string, body: string, extraUniforms?: Uniforms): THREE.RawShaderMaterial;
	/** A single-output material (`out vec4 oColor`). Same prelude and param uniforms. Cached by key. */
	material(key: string, body: string, extraUniforms?: Uniforms): THREE.RawShaderMaterial;
	/**
	 * A single-output material for a pass that doesn't depend on the layer (no u_<param> uniforms, noise or bevel
	 * curves; the state, common and mask helpers and SDFs only): one program for the whole app, cached by key alone.
	 */
	sharedMaterial(key: string, body: string, extraUniforms?: Uniforms): THREE.RawShaderMaterial;
	/** Run an MRT pass into the back state buffer and swap: state textures then point at the result. */
	runMRT(mat: THREE.RawShaderMaterial): void;
	/** Run a single-output pass into a target. Common uniforms are refreshed automatically. */
	run(mat: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget): void;
	/** A float RGBA scratch target (texture size unless given), cached by name (remade when its size changes). */
	scratch(name: string, width?: number, height?: number): THREE.WebGLRenderTarget;
}

export interface HeightStats {
	min: number;
	max: number;
}

const ASPECT_KEY = '~aspect';
const FEATURES_KEY = '~f:';

/**
 * The shader a generator layer runs, for compiling ahead (uncompiled / precompile): its type, plus the variant's parts —
 * an SDF layer with Bevel aspect off 1 carries the exact stretched bevels (`#define BEVEL_ASPECT`, GLSL_BEVEL's
 * bevelAspectOn; at aspect 1 they would give the plain bevel anyway), and a type's optional parts its params use
 * (LayerDef.shaderFeatures, a `#define` each). The usual shader leaves all that code out.
 */
export function shaderKey(layer: Pick<Layer, 'type' | 'params'>): string {
	const def = getLayerDef(layer.type);
	let key = layer.type;
	if (def?.sdf === true && Number(layer.params.bevel_aspect ?? 1) !== 1) key += ASPECT_KEY;
	const f = def?.shaderFeatures?.(layer.params) ?? [];
	if (f.length) key += FEATURES_KEY + [...f].sort().join(',');
	return key;
}
const shaderType = (key: string) => key.split('~')[0];

/** The main() of a filterGlsl filter: the state through its applyFilter, limited by the layer's Limit to. */
const FILTER_MAIN = /* glsl */ `
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(tAlbedo, ip, 0);
  vec4 S = texelFetch(tSurface, ip, 0);
  vec4 E = texelFetch(tEmissive, ip, 0);
  vec4 A0 = A, S0 = S, E0 = E;
  applyFilter(A, S, E, ip);
  float k = limitAt(ip);
  oAlbedo = mix(A0, A, k); oSurface = mix(S0, S, k); oEmissive = mix(E0, E, k); oMask = vec4(0.0);
}
`;
/** The `#define`s a shader key asks for. */
function keyDefines(key: string): string {
	const f = key.split(FEATURES_KEY)[1];
	return (
		(key.includes(ASPECT_KEY) ? '#define BEVEL_ASPECT\n' : '') +
		(f
			? f
					.split(',')
					.map((n) => `#define ${n}\n`)
					.join('')
			: '')
	);
}

export class MaterialPipeline {
	private gpu: Gpu;
	private state: PingPong | null = null;
	private normal: THREE.WebGLRenderTarget | null = null;
	/** Evaluations run so far: what's derived from the result (the tracer's AO) can tell when it changed. */
	evaluations = 0;
	private width = 0;
	private height = 0;
	private materials = new Map<string, THREE.RawShaderMaterial>();
	/** Generator shaders compiled (run, or precompiled), by shaderKey. */
	private compiled = new Set<string>();
	/**
	 * Compile a variant (shaderKey: Bevel aspect, a type's optional parts) in the background where the browser can,
	 * running the plain shader meanwhile (its bevel steps at the mitres, the optional parts missing) and calling
	 * onVariantReady to re-run when it is done: the editor, so the first move of such a slider doesn't freeze the page
	 * for a cold compile. Off for headless renders, which must come out exact.
	 */
	deferVariants = false;
	onVariantReady?: () => void;
	private pendingVariants = new Set<string>();
	/** A comment in generator shaders (measuring cold compiles: a new salt defeats the browser's and driver's caches). */
	private salt = '';
	/** Scratch targets: filters' by their names, the pipeline's own prefixed `~`. */
	private scratchPool: ScratchPool;
	/** Filter materials whose param uniforms are up to date: the evaluation and layer they were last set for. */
	private updatedFor = new Map<THREE.RawShaderMaterial, string>();
	/** Mask slot textures (FR8.23), as many as the last plan needed; `emptyMask` holds MASK_EMPTY everywhere. */
	private slots: THREE.WebGLRenderTarget[] = [];
	private emptyMask: THREE.WebGLRenderTarget | null = null;
	private maskPlan: MaskPlan | null = null;
	/** The masks of the layer being run, bound by setCommon. */
	private cur: {
		input: THREE.Texture | null;
		source: THREE.Texture | null;
		sourceExact: boolean;
		limit: THREE.Texture | null;
		limitSign: number;
	} = {
		input: null,
		source: null,
		sourceExact: true,
		limit: null,
		limitSign: 0
	};
	private fillMat: THREE.RawShaderMaterial | null = null;
	private limitMat: THREE.RawShaderMaterial | null = null;
	private clearMat: THREE.RawShaderMaterial;
	private normalMat: THREE.RawShaderMaterial;
	private reduceMat: THREE.RawShaderMaterial;
	heightStats: HeightStats = { min: 0, max: 0 };
	/** Last compile/runtime error per layer id (shown in the UI). */
	errors = new Map<string, string>();
	/** Called with the layer id before each layer runs (lets the engine attribute shader errors). */
	onBeforeLayer: ((layerId: string) => void) | null = null;

	constructor(gpu: Gpu) {
		this.gpu = gpu;
		this.scratchPool = new ScratchPool(gpu);
		this.clearMat = gpu.material(
			MRT_OUTS +
				/* glsl */ `
      uniform vec4 uBaseAlbedo;
      uniform vec4 uBaseSurface;
      uniform float uBaseSpecular;
      void main() {
        oAlbedo = uBaseAlbedo;
        oSurface = uBaseSurface;
        oEmissive = vec4(0.0, 0.0, 0.0, uBaseSpecular);
        oMask = vec4(0.0);
      }`,
			{
				uBaseAlbedo: { value: new THREE.Vector4() },
				uBaseSurface: { value: new THREE.Vector4() },
				uBaseSpecular: { value: 0.5 }
			}
		);
		this.normalMat = gpu.material(
			STATE_DECLS +
				GLSL_COMMON +
				/* glsl */ `
      out vec4 oColor;
      float hpx(ivec2 c) { return fetchT(tSurface, c).r * uDepth; }
      void main() {
        ivec2 c = ivec2(gl_FragCoord.xy);
        float tl = hpx(c + ivec2(-1, 1)), t = hpx(c + ivec2(0, 1)), tr = hpx(c + ivec2(1, 1));
        float l = hpx(c + ivec2(-1, 0)), h = hpx(c), r = hpx(c + ivec2(1, 0));
        float bl = hpx(c + ivec2(-1, -1)), b = hpx(c + ivec2(0, -1)), br = hpx(c + ivec2(1, -1));
        float dx = ((tr + 2.0 * r + br) - (tl + 2.0 * l + bl)) / 8.0;
        float dy = ((tl + 2.0 * t + tr) - (bl + 2.0 * b + br)) / 8.0;
        oColor = vec4(normalize(vec3(-dx, -dy, 1.0)), h);
      }`,
			this.commonUniforms()
		);
		this.reduceMat = gpu.material(
			/* glsl */ `
      uniform sampler2D tSrc;
      uniform vec2 uSrcSize;
      uniform bool uFirst;
      out vec4 oColor;
      void main() {
        ivec2 base = ivec2(gl_FragCoord.xy) * 8;
        ivec2 lim = ivec2(uSrcSize) - 1;
        float mn = 1e30, mx = -1e30;
        for (int y = 0; y < 8; y++)
        for (int x = 0; x < 8; x++) {
          vec4 v = texelFetch(tSrc, min(base + ivec2(x, y), lim), 0);
          float a = uFirst ? v.w : v.x;
          float b = uFirst ? v.w : v.y;
          mn = min(mn, a);
          mx = max(mx, b);
        }
        oColor = vec4(mn, mx, 0.0, 1.0);
      }`,
			{ tSrc: { value: null }, uSrcSize: { value: new THREE.Vector2() }, uFirst: { value: true } }
		);
	}

	get albedo(): THREE.Texture | null {
		return this.state?.read.textures[0] ?? null;
	}
	get surface(): THREE.Texture | null {
		return this.state?.read.textures[1] ?? null;
	}
	get emissive(): THREE.Texture | null {
		return this.state?.read.textures[2] ?? null;
	}
	/** A mask's texture as the stack left it (the Masks view), or null when nothing writes it. */
	maskTexture(name: string): THREE.Texture | null {
		const r = this.maskPlan?.final.get(name);
		return r ? this.refTexture(r) : null;
	}
	/** The size the stack renders at (the project's, × the supersampling). */
	get size(): { width: number; height: number } {
		return { width: this.width, height: this.height };
	}
	/** Names of the masks the last evaluation wrote. */
	maskNames(): string[] {
		return [...(this.maskPlan?.final.keys() ?? [])];
	}
	get normalTex(): THREE.Texture | null {
		return this.normal?.texture ?? null;
	}

	private commonUniforms(): Uniforms {
		return {
			uRes: { value: new THREE.Vector2() },
			uTile: { value: true },
			uSeed: { value: 0 },
			uDepth: { value: 1 },
			tAlbedo: { value: null },
			tSurface: { value: null },
			tEmissive: { value: null },
			tMaskIn: { value: null },
			tMaskSrc: { value: null },
			tLimit: { value: null },
			uLimit: { value: 0 },
			uMaskSrcExact: { value: true }
		};
	}

	private resize(w: number, h: number): void {
		if (this.state && this.width === w && this.height === h) return;
		this.state?.dispose();
		this.normal?.dispose();
		this.scratchPool.clear();
		this.disposeMasks();
		this.state = new PingPong(this.gpu, w, h, { count: 4 });
		// Linear and repeating: the tracer samples heights between texels along its rays, across the seam on tileable
		// projects (clamping in the shader otherwise). Three applies a target's sampler state only at creation.
		this.normal = this.gpu.target(w, h, { linear: true, wrap: THREE.RepeatWrapping });
		this.width = w;
		this.height = h;
	}

	private setCommon(mat: THREE.RawShaderMaterial, project: Project, seed: number): void {
		const u = mat.uniforms;
		if (u.uRes) (u.uRes.value as THREE.Vector2).set(this.width, this.height);
		if (u.uTile) u.uTile.value = project.tileable;
		if (u.uSeed) u.uSeed.value = seed;
		if (u.uDepth) u.uDepth.value = project.heightDepth;
		if (u.tAlbedo) u.tAlbedo.value = this.state!.read.textures[0];
		if (u.tSurface) u.tSurface.value = this.state!.read.textures[1];
		if (u.tEmissive) u.tEmissive.value = this.state!.read.textures[2];
		const empty = this.emptyMask!.texture;
		if (u.tMaskIn) u.tMaskIn.value = this.cur.input ?? empty;
		if (u.tMaskSrc) u.tMaskSrc.value = this.cur.source ?? empty;
		if (u.uMaskSrcExact) u.uMaskSrcExact.value = this.cur.sourceExact;
		if (u.tLimit) u.tLimit.value = this.cur.limit ?? empty;
		if (u.uLimit) u.uLimit.value = this.cur.limitSign;
	}

	// ---------------------------------------------------------------------------------------------- masks (FR8.23)

	private disposeMasks(): void {
		for (const t of this.slots) t.dispose();
		this.slots = [];
		this.emptyMask?.dispose();
		this.emptyMask = null;
	}

	/** Slot targets for `n` slots, and the empty mask (filled once per size). */
	private ensureMaskTargets(n: number): void {
		while (this.slots.length < n) this.slots.push(this.gpu.target(this.width, this.height));
		if (!this.emptyMask) {
			this.emptyMask = this.gpu.target(this.width, this.height);
			if (!this.fillMat) {
				this.fillMat = this.gpu.material('uniform vec4 uValue;\nout vec4 oColor;\nvoid main() { oColor = uValue; }\n', {
					uValue: { value: new THREE.Vector4() }
				});
			}
			(this.fillMat.uniforms.uValue.value as THREE.Vector4).set(MASK_EMPTY, 0, 0, 0);
			this.gpu.run(this.fillMat, this.emptyMask);
		}
	}

	/** The texture holding a mask version (the empty mask before anything wrote it). */
	private refTexture(r: MaskRef): THREE.Texture {
		return r.slot >= 0 ? this.slots[r.slot].texture : this.emptyMask!.texture;
	}

	/**
	 * Bind a layer's masks for its passes: its input and source, and its limit — one mask read with a sign, or several
	 * combined by a small pass into a scratch target (so generator shaders keep one limit input, whatever the expression).
	 */
	private bindMasks(plan: LayerMasks | undefined): void {
		this.cur = { input: null, source: null, sourceExact: true, limit: null, limitSign: 0 };
		if (!plan) return;
		if (plan.input) this.cur.input = this.refTexture(plan.input);
		if (plan.source) {
			this.cur.source = this.refTexture(plan.source);
			this.cur.sourceExact = plan.source.exact;
		}
		const terms = plan.limit;
		if (!terms) return;
		if (terms.length === 1) {
			this.cur.limit = this.refTexture(terms[0].ref);
			this.cur.limitSign = terms[0].neg ? -1 : 1;
			return;
		}
		const n = Math.min(terms.length, MAX_LIMIT_INPUTS);
		if (!this.limitMat) {
			const fetches = Array.from(
				{ length: MAX_LIMIT_INPUTS },
				(_, i) => `  d[${i}] = texelFetch(tTerm${i}, c, 0).x;`
			).join('\n');
			this.limitMat = this.gpu.material(
				Array.from({ length: MAX_LIMIT_INPUTS }, (_, i) => `uniform sampler2D tTerm${i};`).join('\n') +
					/* glsl */ `
uniform int uOps[${MAX_LIMIT_INPUTS}];
uniform float uSigns[${MAX_LIMIT_INPUTS}];
uniform int uGroups[${MAX_LIMIT_INPUTS}];
uniform int uCount;
out vec4 oColor;
// A limit expression in distance terms (masks.ts LimitTerm): op 0 first, 1 or (min), 2 and (max), 3 minus; group 0 the
// layer's own expression, group 1 its layer group's, intersected.
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float d[${MAX_LIMIT_INPUTS}];
${fetches}
  float acc0 = ${MASK_EMPTY.toFixed(1)}, acc1 = -${MASK_EMPTY.toFixed(1)};
  for (int i = 0; i < ${MAX_LIMIT_INPUTS}; i++) {
    if (i < uCount) {
      float v = uSigns[i] * d[i];
      float a = uGroups[i] == 0 ? acc0 : acc1;
      int op = uOps[i];
      a = op == 0 ? v : op == 1 ? min(a, v) : op == 2 ? max(a, v) : max(a, -v);
      if (uGroups[i] == 0) acc0 = a; else acc1 = a;
    }
  }
  oColor = vec4(max(acc0, acc1), 0.0, 0.0, 0.0);
}
`,
				{
					...Object.fromEntries(Array.from({ length: MAX_LIMIT_INPUTS }, (_, i) => [`tTerm${i}`, { value: null }])),
					uOps: { value: new Int32Array(MAX_LIMIT_INPUTS) },
					uSigns: { value: new Float32Array(MAX_LIMIT_INPUTS) },
					uGroups: { value: new Int32Array(MAX_LIMIT_INPUTS) },
					uCount: { value: 0 }
				}
			);
		}
		const u = this.limitMat.uniforms;
		const OPS = { first: 0, or: 1, and: 2, minus: 3 } as const;
		for (let i = 0; i < MAX_LIMIT_INPUTS; i++) {
			const t = terms[i];
			u[`tTerm${i}`].value = t ? this.refTexture(t.ref) : this.emptyMask!.texture;
			(u.uOps.value as Int32Array)[i] = t ? OPS[t.op] : 0;
			(u.uSigns.value as Float32Array)[i] = t?.neg ? -1 : 1;
			(u.uGroups.value as Int32Array)[i] = t?.group ?? 0;
		}
		u.uCount.value = n;
		const target = this.scratch('~limit');
		this.gpu.run(this.limitMat, target);
		this.cur.limit = target.texture;
		this.cur.limitSign = 1;
	}

	/** A float RGBA scratch target (texture size unless given), cached by name. */
	private scratch(name: string, width = this.width, height = this.height): THREE.WebGLRenderTarget {
		return this.scratchPool.get(name, width, height);
	}

	private blank: THREE.DataTexture | null = null;
	/** Per layer: the inputs its cpuData last ran for, what it returned and the textures made from that. */
	private cpuCache = new Map<
		string,
		{ key: string; data: Record<string, CpuTexture>; tex: Record<string, THREE.DataTexture> }
	>();
	private derived = new DerivedCache();

	private blankTexture(): THREE.DataTexture {
		if (!this.blank) {
			this.blank = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
			this.blank.needsUpdate = true;
		}
		return this.blank;
	}

	/** The canvas a layer's CPU work sees (cpuData, derivedUniforms). */
	private canvas(project: Project, seed: number): LayerCanvas {
		return { width: this.width, height: this.height, tileable: project.tileable, seed };
	}

	/** CPU-computed data textures of a layer (LayerDef.cpuData), cached until its inputs change. */
	private cpuTextures(def: LayerDef, layer: Layer, project: Project, seed: number): Record<string, THREE.DataTexture> {
		// (imagesVersion: an image a layer uses may have finished decoding since.)
		const key = JSON.stringify([layer.params, this.width, this.height, project.tileable, seed, imagesVersion()]);
		const hit = this.cpuCache.get(layer.id);
		if (hit && hit.key === key) return hit.tex;
		const data = def.cpuData!(layer.params, this.canvas(project, seed));
		// cpuData memoises (core/memo.ts): a param it doesn't read changed, and it handed back the same arrays — keep the
		// uploaded textures.
		const names = Object.keys(data);
		if (
			hit &&
			names.length === Object.keys(hit.data).length &&
			names.every((n) => hit.data[n]?.data === data[n].data)
		) {
			hit.key = key;
			return hit.tex;
		}
		if (hit) for (const t of Object.values(hit.tex)) t.dispose();
		const tex: Record<string, THREE.DataTexture> = {};
		for (const [name, d] of Object.entries(data)) {
			const t = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, THREE.UnsignedByteType);
			t.minFilter = THREE.NearestFilter;
			t.magFilter = THREE.NearestFilter;
			t.needsUpdate = true;
			tex[name] = t;
		}
		this.cpuCache.set(layer.id, { key, data, tex });
		return tex;
	}

	/**
	 * A layer's data textures: from the CPU (LayerDef.cpuData, cached) and from its GPU pre-passes over the current state
	 * (LayerDef.prepare, run every time — they read what the layers before left).
	 */
	private bindTextures(
		def: LayerDef,
		layer: Layer,
		project: Project,
		seed: number,
		mat: THREE.RawShaderMaterial
	): void {
		if (def.cpuData)
			for (const [name, t] of Object.entries(this.cpuTextures(def, layer, project, seed)))
				mat.uniforms[`t_${name}`].value = t;
		if (def.prepare) {
			for (const t of def.textures ?? []) mat.uniforms[`t_${t}`].value = this.blankTexture();
			for (const [name, t] of Object.entries(def.prepare(this.filterContext(project, layer, seed), layer)))
				mat.uniforms[`t_${name}`].value = t;
		}
	}

	/** Upload a layer's derived uniforms for `params` (LayerDef.derivedUniforms); `slot` keys their cache. */
	private bindDerived(
		def: LayerDef,
		slot: string,
		params: Layer['params'],
		project: Project,
		seed: number,
		mat: THREE.RawShaderMaterial
	): void {
		const d = def.derivedUniforms;
		if (d) setDerived(mat.uniforms, d, this.derived.values(slot, d, params, this.canvas(project, seed)));
	}

	/** GLSL and zeroed uniforms of a layer's inputs beside its params: its data textures and derived uniforms. */
	private layerInputs(def: LayerDef): { glsl: string; uniforms: Uniforms } {
		const tex = def.textures ?? [];
		return {
			glsl: tex.map((t) => `uniform sampler2D t_${t};\n`).join('') + declareDerived(def.derivedUniforms),
			uniforms: {
				...Object.fromEntries(tex.map((t) => [`t_${t}`, { value: this.blankTexture() }])),
				...createDerived(def.derivedUniforms)
			}
		};
	}

	/** Generator shaders among `keys` (shaderKey) not compiled yet: their first run would compile them, stalling the page. */
	uncompiled(keys: string[]): string[] {
		return [...new Set(keys)].filter((k) => getLayerDef(shaderType(k))?.kind === 'generator' && !this.compiled.has(k));
	}

	/** Generator shaders compile afresh after this (cold-compile timing; the old programs stay cached under the old salt). */
	setShaderSalt(salt: string): void {
		this.salt = salt;
		this.compiled.clear();
	}

	/**
	 * Compile generators' shaders ahead of their first run (see GpuContext.compile). They are all submitted at once (the
	 * browser compiles them in parallel); `onProgress` hears how many have finished as each one does.
	 */
	async precompile(keys: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
		const todo = this.uncompiled(keys);
		let done = 0;
		await Promise.all(
			todo.map(async (k) => {
				await this.gpu.compile([this.generatorMaterial(getLayerDef(shaderType(k))!, k)]);
				this.compiled.add(k);
				onProgress?.(++done, todo.length);
			})
		);
	}

	private compileVariant(def: LayerDef, key: string): void {
		if (this.pendingVariants.has(key)) return;
		this.pendingVariants.add(key);
		this.gpu
			.compile([this.generatorMaterial(def, key)])
			.then(() => {
				this.pendingVariants.delete(key);
				this.compiled.add(key);
				this.onVariantReady?.();
			})
			// Retried on the variant's next use.
			.catch(() => this.pendingVariants.delete(key));
	}

	/**
	 * A layer-stage material: the prelude, `outs`, the layer type's u_<param> uniforms (and bevel curves), then `body`;
	 * `head` goes before it all (variant #defines).
	 */
	private stageMaterial(
		type: string,
		outs: string,
		body: string,
		extra: Uniforms = {},
		head = ''
	): THREE.RawShaderMaterial {
		const defs = layerParamDefs(type);
		return this.gpu.material(
			head + bevelCurveDefine(defs) + MATERIAL_PRELUDE + outs + declareUniforms(defs) + bevelCurveImpl(defs) + body,
			{ ...this.commonUniforms(), ...createUniforms(defs), ...extra }
		);
	}

	/** shader: the shaderKey of the variant (default: the plain shader). */
	private generatorMaterial(def: LayerDef, shader: string = def.type): THREE.RawShaderMaterial {
		const key = `gen:${shader}${this.salt}`;
		let mat = this.materials.get(key);
		if (!mat) {
			const inputs = this.layerInputs(def);
			const body =
				GENOUT +
				(def.sdf ? GLSL_BEVEL : '') +
				inputs.glsl +
				(def.glsl ?? '') +
				GLSL_GENERATOR_MAIN(def.sdf === 'mask' ? 'mask' : Boolean(def.sdf));
			mat = this.stageMaterial(
				def.type,
				MRT_OUTS,
				body,
				{ ...inputs.uniforms, uMaskKind: { value: 0 }, uMaskSoft: { value: false } },
				(this.salt ? `// salt ${this.salt}\n` : '') + keyDefines(shader)
			);
			this.materials.set(key, mat);
		}
		return mat;
	}

	private filterContext(project: Project, layer: Layer, seed: number): FilterContext {
		// oxlint-disable-next-line no-this-alias -- getters on the context object need the pipeline
		const self = this;
		const build = (key: string, body: string, outs: string, extra?: Uniforms) => {
			const k = `flt:${layer.type}:${key}`;
			let mat = self.materials.get(k);
			if (!mat) {
				mat = self.stageMaterial(layer.type, outs, outs === MRT_OUTS ? withMaskOut(body) : body, extra);
				self.materials.set(k, mat);
			}
			// Once per layer and evaluation: text params re-pack, curves recompute their tangents.
			const stamp = `${self.evaluations}:${layer.id}`;
			if (self.updatedFor.get(mat) !== stamp) {
				updateUniforms(mat.uniforms, layerParamDefs(layer.type), layer.params);
				self.updatedFor.set(mat, stamp);
			}
			return mat;
		};
		return {
			gpu: this.gpu,
			project,
			layer,
			width: this.width,
			height: this.height,
			get albedo() {
				return self.state!.read.textures[0];
			},
			get surface() {
				return self.state!.read.textures[1];
			},
			get emissive() {
				return self.state!.read.textures[2];
			},
			get maskSource() {
				const r = self.maskPlan?.layers.get(layer.id)?.source;
				return r ? { texture: self.refTexture(r), exact: r.exact } : null;
			},
			seed,
			mrtMaterial: (key, body, extra) => build(key, body, MRT_OUTS, extra),
			material: (key, body, extra) => build(key, body, 'out vec4 oColor;\n', extra),
			sharedMaterial(key, body, extra) {
				const k = `shared:${key}`;
				let mat = self.materials.get(k);
				if (!mat) {
					mat = self.gpu.material(SHARED_PRELUDE + 'out vec4 oColor;\n' + body, {
						...self.commonUniforms(),
						...extra
					});
					self.materials.set(k, mat);
				}
				return mat;
			},
			runMRT(mat) {
				self.setCommon(mat, project, seed);
				self.gpu.run(mat, self.state!.write);
				self.state!.swap();
			},
			run(mat, target) {
				self.setCommon(mat, project, seed);
				self.gpu.run(mat, target);
			},
			scratch: (name, w, h) => self.scratch(name, w, h)
		};
	}

	/**
	 * Evaluate the stack. `upTo` (inclusive layer index) previews the stack partway; -1 = base only.
	 */
	evaluate(project: Project, upTo = Infinity): void {
		this.resize(project.width, project.height);
		const state = this.state!;
		this.errors.clear();
		this.evaluations++;
		// CPU data of layers no longer in the stack.
		const ids = new Set(project.layers.map((l) => l.id));
		for (const [id, hit] of this.cpuCache) {
			if (ids.has(id)) continue;
			for (const t of Object.values(hit.tex)) t.dispose();
			this.cpuCache.delete(id);
		}
		this.derived.prune(ids);

		// Clear to the base material.
		const base = project.base;
		const lin = hexToLinear(base.color);
		const cu = this.clearMat.uniforms;
		(cu.uBaseAlbedo.value as THREE.Vector4).set(lin[0], lin[1], lin[2], base.opacity);
		(cu.uBaseSurface.value as THREE.Vector4).set(base.height, base.roughness, base.metalness, 0);
		cu.uBaseSpecular.value = base.specular;
		this.gpu.run(this.clearMat, state.write);
		state.swap();

		// Masks (FR8.23): which versions later layers read, and a slot for each while they do.
		const plan = planMasks(project, upTo);
		this.maskPlan = plan;
		this.ensureMaskTargets(plan.slots);

		const hidden = hiddenByGroup(project);
		project.layers.forEach((layer, index) => {
			if (index > upTo || !layer.enabled || hidden.has(layer.id)) return;
			const def = getLayerDef(layer.type);
			if (!def) {
				this.errors.set(layer.id, `Unknown layer type "${layer.type}"`);
				return;
			}
			const seed = mixSeed(Number(layer.params.seed ?? 0), project.seed);
			const masks = plan.layers.get(layer.id);
			this.onBeforeLayer?.(layer.id);
			try {
				this.bindMasks(masks);
				if (def.kind === 'generator') {
					let key = shaderKey(layer);
					if (key !== layer.type && this.deferVariants && this.gpu.parallelCompile && !this.compiled.has(key)) {
						this.compileVariant(def, key);
						key = layer.type;
					}
					const mat = this.generatorMaterial(def, key);
					this.bindTextures(def, layer, project, seed, mat);
					// Its other mask writes (Write to's rows): the same shader with their params, into the scratch side of
					// the state (the layer's own pass overwrites it next); only their mask output is kept.
					masks?.extra.forEach((e, i) => {
						updateUniforms(mat.uniforms, layerParamDefs(def.type), e.params);
						this.bindDerived(def, `${layer.id}#${i}`, e.params, project, seed, mat);
						this.cur.input = this.refTexture(e.input);
						this.setCommon(mat, project, seed);
						mat.uniforms.uMaskKind.value = maskKind(e.write);
						mat.uniforms.uMaskSoft.value = e.soft;
						this.gpu.run(mat, state.write);
						if (e.write.slot >= 0) this.gpu.copy(state.write.textures[3], this.slots[e.write.slot]);
					});
					if (masks?.extra.length) this.cur.input = masks.input ? this.refTexture(masks.input) : null;
					// Its own pass, with its first row's source (a part for the mask) over its params.
					const own = masks?.params ?? layer.params;
					updateUniforms(mat.uniforms, layerParamDefs(def.type), own);
					this.bindDerived(def, layer.id, own, project, seed, mat);
					this.setCommon(mat, project, seed);
					const w = masks?.write;
					mat.uniforms.uMaskKind.value = maskKind(w);
					mat.uniforms.uMaskSoft.value = false;
					this.gpu.run(mat, state.write);
					this.compiled.add(key);
					state.swap();
					// The new version of its mask, kept while a later layer reads it.
					if (w && w.slot >= 0) this.gpu.copy(state.read.textures[3], this.slots[w.slot]);
				} else if (def.run) {
					// Multi-pass filters: limited, they run on the whole state and are blended back by the limit after.
					const limited = Boolean(masks?.limit);
					if (limited) this.snapshot(project);
					def.run(this.filterContext(project, layer, seed), layer);
					if (limited) this.blendLimited(project, layer, seed);
				} else if (def.filterGlsl) {
					// One pass, limited in itself, after any pre-passes (LayerDef.prepare) it reads.
					const ctx = this.filterContext(project, layer, seed);
					const inputs = this.layerInputs(def);
					const mat = ctx.mrtMaterial('main', inputs.glsl + def.filterGlsl + FILTER_MAIN, inputs.uniforms);
					this.bindTextures(def, layer, project, seed, mat);
					this.bindDerived(def, layer.id, layer.params, project, seed, mat);
					ctx.runMRT(mat);
				}
			} catch (e) {
				this.errors.set(layer.id, e instanceof Error ? e.message : String(e));
			}
		});
		this.bindMasks(undefined);

		// Normals (xyz) + world height in px (w).
		this.onBeforeLayer?.('normals');
		this.setCommon(this.normalMat, project, 0);
		this.gpu.run(this.normalMat, this.normal!);
		this.updateHeightStats();
	}

	private snapshotTarget: THREE.WebGLRenderTarget | null = null;
	private copyMat: THREE.RawShaderMaterial | null = null;

	/** Copy the current state aside (before a limited multi-pass filter). */
	private snapshot(project: Project): void {
		if (
			!this.snapshotTarget ||
			this.snapshotTarget.width !== this.width ||
			this.snapshotTarget.height !== this.height
		) {
			this.snapshotTarget?.dispose();
			// The three state attachments (blendLimited reads them); the pass's mask output goes nowhere.
			this.snapshotTarget = this.gpu.target(this.width, this.height, { count: 3 });
		}
		if (!this.copyMat) {
			this.copyMat = this.gpu.material(
				STATE_DECLS +
					GLSL_COMMON +
					MRT_OUTS +
					/* glsl */ `
        void main() {
          ivec2 c = ivec2(gl_FragCoord.xy);
          oAlbedo = texelFetch(tAlbedo, c, 0); oSurface = texelFetch(tSurface, c, 0); oEmissive = texelFetch(tEmissive, c, 0); oMask = vec4(0.0);
        }`,
				this.commonUniforms()
			);
		}
		this.setCommon(this.copyMat, project, 0);
		this.gpu.run(this.copyMat, this.snapshotTarget);
	}

	/** Blend a limited multi-pass filter's result with the state before it, by the layer's limit. */
	private blendLimited(project: Project, layer: Layer, seed: number): void {
		const ctx = this.filterContext(project, layer, seed);
		const mat = ctx.mrtMaterial(
			'limit-blend',
			/* glsl */ `
      uniform sampler2D tPrevA;
      uniform sampler2D tPrevS;
      uniform sampler2D tPrevE;
      void main() {
        ivec2 c = ivec2(gl_FragCoord.xy);
        float k = limitAt(c);
        oAlbedo = mix(texelFetch(tPrevA, c, 0), texelFetch(tAlbedo, c, 0), k);
        oSurface = mix(texelFetch(tPrevS, c, 0), texelFetch(tSurface, c, 0), k);
        oEmissive = mix(texelFetch(tPrevE, c, 0), texelFetch(tEmissive, c, 0), k);
        oMask = vec4(0.0);
      }`,
			{ tPrevA: { value: null }, tPrevS: { value: null }, tPrevE: { value: null } }
		);
		const t = this.snapshotTarget!.textures;
		mat.uniforms.tPrevA.value = t[0];
		mat.uniforms.tPrevS.value = t[1];
		mat.uniforms.tPrevE.value = t[2];
		ctx.runMRT(mat);
	}

	/** Min/max world height via an 8×8-block GPU reduction, then a tiny readback. */
	private updateHeightStats(): void {
		let src: THREE.Texture = this.normal!.texture;
		let w = this.width;
		let h = this.height;
		let first = true;
		let level = 0;
		while (first || w > 8 || h > 8) {
			const nw = Math.max(1, Math.ceil(w / 8));
			const nh = Math.max(1, Math.ceil(h / 8));
			const t = this.scratch(`~reduce${level}`, nw, nh);
			const u = this.reduceMat.uniforms;
			u.tSrc.value = src;
			(u.uSrcSize.value as THREE.Vector2).set(w, h);
			u.uFirst.value = first;
			this.gpu.run(this.reduceMat, t);
			src = t.texture;
			w = nw;
			h = nh;
			first = false;
			level++;
		}
		const data = this.gpu.readTexture(src, w, h);
		let min = Infinity;
		let max = -Infinity;
		for (let i = 0; i < data.length; i += 4) {
			min = Math.min(min, data[i]);
			max = Math.max(max, data[i + 1]);
		}
		if (!Number.isFinite(min) || !Number.isFinite(max)) min = max = 0;
		this.heightStats = { min, max };
	}

	/** Read the material at one texel (x, y in user space: y down). */
	probe(x: number, y: number): { albedo: Float32Array; surface: Float32Array; emissive: Float32Array } | null {
		if (!this.state || x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
		const gy = this.height - 1 - y;
		const r = this.gpu.renderer;
		const read = (i: number) => {
			const buf = new Float32Array(4);
			r.readRenderTargetPixels(this.state!.read, x, gy, 1, 1, buf, undefined, i);
			return buf;
		};
		return { albedo: read(0), surface: read(1), emissive: read(2) };
	}

	/** A mask's texel (distance, feature random, feature flag) as the stack left it, at x, y (user space: y down). */
	probeMask(name: string, x: number, y: number): Float32Array | null {
		const r = this.maskPlan?.final.get(name);
		if (!r || x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
		if (r.slot < 0) return Float32Array.of(MASK_EMPTY, 0, 0, 0);
		const buf = new Float32Array(4);
		this.gpu.renderer.readRenderTargetPixels(this.slots[r.slot], x, this.height - 1 - y, 1, 1, buf);
		return buf;
	}

	dispose(): void {
		this.state?.dispose();
		this.normal?.dispose();
		for (const m of this.materials.values()) m.dispose();
		this.updatedFor.clear();
		this.scratchPool.clear();
		this.disposeMasks();
		this.clearMat.dispose();
		this.normalMat.dispose();
		this.reduceMat.dispose();
		this.copyMat?.dispose();
		this.fillMat?.dispose();
		this.limitMat?.dispose();
		this.snapshotTarget?.dispose();
		this.blank?.dispose();
		for (const hit of this.cpuCache.values()) for (const t of Object.values(hit.tex)) t.dispose();
		this.cpuCache.clear();
	}
}
