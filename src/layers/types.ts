import type { GroupDef, ParamDef, ParamValue, ParamValues } from '@/core/params';
import type { Layer } from '@/core/project';
import type { FilterContext } from '@/render/materialPipeline';
import type * as THREE from 'three';

export type LayerCategory = 'noise' | 'shape' | 'pattern' | 'filter' | 'adjust';

export interface LayerDef {
	type: string;
	label: string;
	category: LayerCategory;
	kind: 'generator' | 'filter';
	description?: string;
	/** Type-specific params (group defaults to 'params'). */
	params: ParamDef[];
	/**
	 * Generators: GLSL defining `GenOut gen(vec2 p)` where p is the GL pixel position (centres at .5).
	 * In scope: the common/noise/sdf GLSL chunks, `uSeed` (layer seed), `uRes`, `uTile`, the previous state
	 * samplers `tAlbedo`, `tSurface`, `tEmissive`, and a `u_<key>` uniform per param.
	 * Construct results with `genOut(value, mask, rnd, sdf)` (rnd: one random per feature — brick, cell, instance);
	 * `genOutSmooth` for patterns without features (smooth noise, clouds: Per-feature variation off, or it terraces);
	 * `genOutHeight(…, height)` with a signed height profile of the generator's own; `genOutOwn` (an SDF layer painting
	 * its own value and coverage, the shape only going to the mask) or `genOutShaded` (its pattern × the shape's bevel).
	 * See GENOUT in render/materialPipeline.ts.
	 */
	glsl?: string;
	/**
	 * Generator produces a signed distance (px, negative inside) in GenOut.sdf. The wrapper then adds the Edge card
	 * (bevel, profile, anti-alias, soft edge, dilate) and derives mask + value from the distance; the mask it writes, and
	 * how (Mask › Write to › Mode), is in the Mask card.
	 * A gen() may return sdf <= NO_SDF (-9e4) to opt out per-pixel (value/mask pass through, the mask it writes keeps
	 * what was there).
	 * 'mask': the distance only goes to the mask the layer writes (Mask › Write to) — the generator shapes its own value
	 * and coverage around it (Drips' blisters: a lifted lip outside the edge, a pit inside). Its Edge card (Bevel 0 by
	 * default) shapes that value by the profile of its distance.
	 */
	sdf?: boolean | 'mask';
	/**
	 * Generators only (FR8.30): the layer can be restricted to an Area — a rectangle of the canvas it is laid out in
	 * (its `uRes`, origin and CPU canvas become the area's; no wrapping unless it is the whole canvas) and limited to,
	 * with a grid over it whose cells can be switched off (commonParams AREA_PARAMS, edited by GridGizmo.vue). For layers
	 * that lay out against `uRes` and don't read the layers below at moved coordinates. `'layout'`: the grid is also the
	 * layer's own layout (Panelling's panels), so the gizmo offers merging cells too.
	 */
	area?: boolean | 'layout';
	/**
	 * When the shape params apply (default: always) — e.g. only one of a generator's outputs has a shape. Called with a
	 * `key` it decides that one Edge control (a value mode may keep Anti-alias but hide Bevel); without one, whether the
	 * layer has a shape at all.
	 */
	sdfShowIf?: (params: ParamValues, key?: string) => boolean;
	/**
	 * What the layer writes into its mask (Mask › Write to) with these params: its shape (a signed distance), its
	 * coverage, or nothing (false). Default: SDF layers their shape wherever `sdfShowIf` gives them one (else nothing),
	 * other generators their coverage — e.g. a relief output that has Edge controls but writes its shape only when told
	 * which part to write (masks.ts).
	 */
	maskWrite?: (params: ParamValues) => 'shape' | 'coverage' | false;
	/**
	 * What the layer can write into a mask (Mask › Write to › Source), the first the default. Without its own list a type
	 * offers This layer (as drawn); either way the registry adds one per option of its Output enum (`output: …`, written as
	 * its coverage × value, so a gradient output fades along it). A source's `params` run over the layer's for that write —
	 * a pass of its own before the layer's, unless it is `main` (it changes only what goes to the mask: Greebles' parts,
	 * Crystal's facets), in which case the first row's write rides in the layer's own pass.
	 */
	maskSources?: MaskSourceDef[];
	/**
	 * Reads the mask before it in its own shader (`maskIn()`: its write target's, or the Shape mask when it writes none)
	 * — Chips damages the shape there, Tabs sit on its outline, Glass refracts inside it. Other layers read masks only
	 * through Limit to.
	 */
	readsMask?: boolean;
	/** The mask a layer reads as its source with these params (`tMaskSrc`; edge filters, Mask area), or null. */
	maskSource?: (params: ParamValues) => string | null;
	/**
	 * Its value is only the coverage of its source mask when that holds a plain coverage (`source.plain`; Mask area ›
	 * Inside without Breakup): its Pattern sources then default to Solid when it starts reading one, and what it writes
	 * is a plain coverage too.
	 */
	coverageOnly?: (params: ParamValues, source: { plain: boolean } | null) => boolean;
	/**
	 * Filters: a single MRT pass, limited by the layer's Limit to. GLSL defining
	 * `void applyFilter(inout vec4 A, inout vec4 S, inout vec4 E, ivec2 ip)` (note: `filter` is a reserved word in GLSL ES
	 * 3.00). With `prepare` and `textures` it can read pre-passes (a blur, a distance field).
	 */
	filterGlsl?: string;
	/**
	 * Filters: full control, may issue several passes (Blur's two). Takes precedence over filterGlsl. Limited, the
	 * pipeline copies the state aside before and blends the result back by the limit after (two more full passes):
	 * filterGlsl with `prepare` avoids them.
	 */
	run?: (ctx: FilterContext, layer: Layer) => void;
	/**
	 * Generators: data computed on the CPU from the params — global, sequential algorithms a pixel shader can't run (e.g.
	 * routing). Returns RGBA8 textures by name, bound as `uniform sampler2D t_<name>` (declare the names in `textures`).
	 * Recomputed only when the params, size, tiling or seed change.
	 */
	cpuData?: (params: ParamValues, ctx: LayerCanvas) => Record<string, CpuTexture>;
	/** Names of the `uniform sampler2D t_<name>` that cpuData or prepare bind. */
	textures?: string[];
	/**
	 * GPU passes over the current state run just before the layer (generators: a distance field of something in the
	 * heights below; filterGlsl filters: a blur or jump flood their applyFilter reads). Returns textures by name, bound
	 * like cpuData's (declare the names in `textures`; any it leaves out stay blank). Runs on every evaluation, so keep it
	 * to what the layer's params ask for. The layer's own pass still applies its limit, so a limited filter costs nothing
	 * extra.
	 */
	prepare?: (ctx: FilterContext, layer: Layer) => Record<string, THREE.Texture>;
	/**
	 * Values the layer's shader needs that depend only on its params and the canvas (a lattice that tiles the canvas, a
	 * gcd of its sides, a fit): computed once per render on the CPU instead of at every pixel. Each name in `decl` is a
	 * `uniform <type> d_<name>;` in the layer's shader (generators and filterGlsl filters); `compute` returns their
	 * values (a number, or the components in order for a vector or array). The params are already pixel-scaled
	 * (supersampling, canvas size). Recomputed only when the params, size, tiling or seed change.
	 */
	derivedUniforms?: DerivedUniforms;
	/**
	 * Generators: the pattern comes from the noise library (glsl/noise.ts) or its cell points, so a Phase param in the
	 * Pattern card animates it. Other generators get the Phase in Shaping, shown while a domain warp is on.
	 */
	noise?: boolean;
	/**
	 * What a layer added in the editor starts with, over the defaults (sized to the texture). Code that builds layers —
	 * recipes, templates, presets — and stored projects keep the plain defaults, so new looks can be offered without
	 * changing old ones.
	 */
	fresh?: (texture: { width: number; height: number }) => ParamValues;
	/**
	 * Defaults that follow other params (Drips: Height on for the Sources output). A new layer takes them unless given
	 * them; changing a param moves any still at its old default to the new one (`linkedChanges`), so a value set by
	 * hand stays.
	 */
	linkedDefaults?: (params: ParamValues) => ParamValues;
	/**
	 * Optional parts of the generator's shader that these params use: each name becomes a `#define` in a variant compiled
	 * for the layers that need it (shaderKey), so a layer that leaves them off compiles without them. D3D11's cold compile
	 * grows faster than the shader (docs/shader-compilation.md); keep the names few and stable.
	 */
	shaderFeatures?: (params: ParamValues) => string[];
	/**
	 * Generators with a level of their own per part (Greebles: metal pipes, plastic switches, glowing lights): what the parts
	 * are. Roughness, Specular, Metalness and Emissive then offer Source › Parts, which reads `gGenLevel` (x roughness,
	 * y specular, z metalness, w emissive; < 0 = the Pattern value) as the generator sets it per pixel.
	 */
	parts?: string;
	/** Overrides for common param defaults (e.g. which channel outputs start enabled). */
	defaults?: Record<string, ParamValue>;
	/** This type's own hint, label or note on a common param (e.g. a note on Bevel when this type caps it). */
	paramPatch?: Record<string, Pick<ParamDef, 'hint' | 'labelFor' | 'note'>>;
	/** Extra groups for this type's params, in display order (the default 'params' group is implicit). */
	groups?: GroupDef[];
	/**
	 * Filters: which of the outliner's Diffuse and Height columns the filter affects — a bool param key when a tick turns
	 * it on and off, `true` when it always does. Generators use their Diffuse / Height outputs (dif_on / h_on).
	 */
	channels?: LayerChannels;
}

/** One of a layer type's mask sources (LayerDef.maskSources). */
export interface MaskSourceDef {
	value: string;
	label: string;
	hint?: string;
	/** Params over the layer's for this write. */
	params: ParamValues;
	/** Changes only what goes to the mask, not what the layer draws: the first row's write may ride in its own pass. */
	main?: boolean;
	/** An output's value: a coverage write takes the value too (coverage × value). */
	soft?: boolean;
}

export interface LayerChannels {
	diffuse?: string | true;
	height?: string | true;
}

/** The canvas a layer renders on, for what it computes on the CPU (cpuData, derivedUniforms). */
export interface LayerCanvas {
	/** Size in px (the project's, × the supersampling). */
	width: number;
	height: number;
	tileable: boolean;
	/** The layer's combined seed (uSeed). */
	seed: number;
}

/** A derived uniform's GLSL type: a scalar or vector, or a fixed-size array of one (`'float[16]'`, `'ivec2[4]'`). */
export type DerivedUniformType = DerivedUniformBase | `${DerivedUniformBase}[${number}]`;
export type DerivedUniformBase = 'int' | 'float' | 'ivec2' | 'ivec3' | 'ivec4' | 'vec2' | 'vec3' | 'vec4';

/** LayerDef.derivedUniforms: what the shader declares, and how to compute it. */
export interface DerivedUniforms {
	/** Name → type, declared as `uniform <type> d_<name>;`. */
	decl: Record<string, DerivedUniformType>;
	/** A value per declared name: a number (int types must be integers), or a vector's or array's components in order. */
	compute: (params: ParamValues, ctx: LayerCanvas) => Record<string, number | ArrayLike<number>>;
}

/** An RGBA8 texture computed on the CPU (LayerDef.cpuData). */
export interface CpuTexture {
	width: number;
	height: number;
	data: Uint8Array;
}
