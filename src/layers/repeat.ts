// The shared Repeat (FR8.33, docs/features/fr8.33-repeat-around-mask.md): the Repeat card every repeating generator has
// (repeatParams) and what it needs beside its shader (withRepeat): on an outline, the mask it reads, the MASK_REPEAT
// variant and the instances placed on the CPU (outline.ts), handed to glsl/repeat.ts as two data textures.

import * as THREE from 'three';
import { P, type ParamDef, type ParamValues } from '@/core/params';
import { SHAPE_MASK } from '@/core/project';
import { DISTANCE_SOURCE, jumpFlood } from '@/gpu/jfa';
import type { FilterContext } from '@/render/materialPipeline';
import type { Layer } from '@/core/project';
import { spacingParams } from './commonParams';
import {
	bucketInstances,
	canvasOutline,
	INST_ROW,
	placeInstances,
	traceOutlines,
	type Outline,
	type PlaceOptions
} from './outline';
import type { LayerDef } from './types';

const group = 'repeat';
/** The Repeat card. */
export const REPEAT_GROUP = { id: group, label: 'Repeat', collapsed: true };
/** At most this many instances along outlines, in all. */
export const MAX_OUTLINE_INSTANCES = 4096;

/** On an outline (a mask's, or the texture's edges) rather than a grid. */
export const onOutline = (p: ParamValues) => p.rep_place === 'mask' || p.rep_place === 'edges';
export const onGrid = (p: ParamValues) => !onOutline(p);
const bySide = (p: ParamValues) => onOutline(p) && p.rep_along === 'side';
const and =
	(a: (p: ParamValues) => boolean, b?: ParamDef['showIf']) =>
	(p: ParamValues): boolean =>
		a(p) && (b ? b(p) : true);

/** Edges (rep_faces), in outline.ts' faceOn order. */
const FACES: [string, string][] = [
	['all', 'All'],
	['sides', 'Left + right'],
	['ends', 'Top + bottom'],
	['left', 'Left'],
	['right', 'Right'],
	['top', 'Top'],
	['bottom', 'Bottom']
];

export interface RepeatOptions {
	/**
	 * The family's grid rows: 'cells' — Columns and Rows across the texture, Column / Row spacing, Row offset, the mirrors
	 * (shapes, motifs, Tabs) — or its own rows (Stamp's and Path's copies a step apart). Shown on the grid only.
	 */
	grid: 'cells' | ParamDef[];
	/** 'cells': the Columns / Rows sliders' top. */
	softMax?: number;
	/** Position jitter in px (`rep_jitter`) or as a share of a step (`rep_jit`: half a step at 1). */
	jitter: 'px' | 'cell';
	scaleHint?: string;
	/**
	 * Rows a family has no use for, kept at their defaults but never shown (Tabs: its own Side and Inset instead of Offset;
	 * it always follows the edge, and has no X / Y for the mirrors to mirror).
	 */
	without?: string[];
	/** Defaults over the shared ones (Tabs: around the mask, along each side, clear of the corners). */
	defaults?: ParamValues;
	/** The family's own rows after one of these (by key). */
	after?: Record<string, ParamDef[]>;
}

/**
 * The Repeat card: Place (grid, around a mask, along the texture's edges), the family's grid rows, the outline rows, then
 * the variation every layout shares — Position jitter, Rotation variation and its steps, Flip at random, Size variation,
 * Drop out — and the Seed (outside the card: it seeds the layer's own randoms too).
 */
export function repeatParams(o: RepeatOptions): ParamDef[] {
	const grid =
		o.grid === 'cells'
			? [
					P.int('rep_x', 'Columns', 1, 1, 256, { softMax: o.softMax ?? 32 }),
					P.int('rep_y', 'Rows', 1, 1, 256, { softMax: o.softMax ?? 32 }),
					...spacingParams(),
					P.float('rep_stagger', 'Row offset', 0, 0, 1, {
						step: 0.001,
						hint: 'Shifts every other row sideways (use an even row count to tile)'
					}),
					P.bool('rep_mirror_x', 'Mirror odd columns', false, {
						hint: 'Mirrors the position left / right in every other column. For example, 2 columns put a pair of instances near the outer edges, or a rivet line along both edges of a plate'
					}),
					P.bool('rep_mirror_y', 'Mirror odd rows', false, {
						hint: 'Mirrors the position up / down in every other row. With Mirror odd columns, 2×2 puts one instance in each corner'
					})
				]
			: o.grid;
	const without = new Set(o.without ?? []);
	// Read by the placement on the CPU (prepare), not by the shader — but Follow the edge.
	const outline: ParamDef[] = (
		[
			P.text('rep_mask', 'Mask', SHAPE_MASK, {
				mask: 'read',
				showIf: (p) => p.rep_place === 'mask',
				hint: 'Picks the mask to follow, by name (Shape = the one shape layers write). Where it’s empty, the repeats follow the texture’s edges instead'
			}),
			P.enum(
				'rep_along',
				'Spread over',
				'outline',
				[
					['outline', 'Each outline', 'round every separate outline: each piece of the mask, and each hole in it'],
					['side', 'Each side', 'along every straight side, from corner to corner']
				],
				{ optimize: false, showIf: onOutline }
			),
			P.enum(
				'rep_count_by',
				'Count',
				'repeats',
				[
					['repeats', 'Repeats', 'the same number on every outline or side'],
					['spacing', 'Spacing', 'one about every Spacing px, so long outlines and sides get more']
				],
				{ optimize: false, showIf: onOutline }
			),
			P.int('rep_n', 'Repeats', 8, 1, 1024, {
				softMax: 64,
				showIf: (p) => onOutline(p) && p.rep_count_by !== 'spacing',
				hint: `Sets how many go on each outline, or on each side. On a side they start at its corner: 1 puts one on every corner, 2 adds the middles, 3 the thirds. Up to ${MAX_OUTLINE_INSTANCES} in all`
			}),
			P.float('rep_space', 'Spacing', 16, 1, 4096, {
				softMax: 256,
				unit: 'px',
				step: 0.5,
				showIf: (p) => onOutline(p) && p.rep_count_by === 'spacing',
				hint: 'Sets roughly how far apart the repeats are, centre to centre. Each outline or side gets a whole number of them, evenly spread; outlines shorter than half a step get none'
			}),
			P.enum(
				'rep_corners',
				'Corners',
				'on',
				[
					['on', 'On the corners', 'one on every corner, the rest spread between them'],
					['clear', 'Clear of the corners', 'spread evenly along each side, away from its ends']
				],
				{ optimize: false, showIf: bySide }
			),
			P.float('rep_clear', 'Corner clearance', 6, 0, 1024, {
				softMax: 64,
				unit: 'px',
				step: 0.5,
				showIf: (p) => bySide(p) && p.rep_corners === 'clear',
				hint: 'Keeps the repeats at least this far from the ends of each side. Sides too short for the count get fewer, or none'
			}),
			P.float('rep_corner', 'Corner angle', 30, 5, 150, {
				unit: '°',
				step: 0.5,
				showIf: bySide,
				hint: 'Sets how sharply the outline has to turn to count as a corner (30° counts the corners of every polygon up to twelve sides)'
			}),
			P.float('rep_round', 'Rounded corners up to', 16, 0, 1024, {
				softMax: 64,
				unit: 'px',
				step: 0.5,
				showIf: bySide,
				hint: 'Counts a corner rounded up to this radius as one corner, its repeat in the middle of the curve. Rounder bends are part of a curved side'
			}),
			P.enum('rep_faces', 'Edges', 'all', FACES, {
				optimize: false,
				showIf: onOutline,
				hint: 'Keeps only the sides facing these ways (on Each outline, the repeats facing them): rivets along the top and bottom of a plate only'
			}),
			P.float('rep_off', 'Offset', 0, -4096, 4096, {
				softMin: -128,
				softMax: 128,
				unit: 'px',
				step: 0.5,
				showIf: onOutline,
				hint: 'Moves the repeats off the edge: outward above 0, inward below. They follow the outline at that distance, round the corners outside it and on a smaller loop inside'
			}),
			P.bool('rep_follow', 'Follow the edge', true, {
				showIf: onOutline,
				hint: 'Turns each repeat to the direction of the edge, its top facing away from the mask (Rotation turns it further). Off: every repeat keeps Rotation'
			}),
			P.float('rep_shift', 'Shift along', 0, -1, 1, {
				step: 0.001,
				showIf: onOutline,
				hint: 'Slides every repeat along the outline by this share of the step between them, e.g. off the corners'
			})
		] as ParamDef[]
	).map((d) => (d.key === 'rep_follow' ? d : { ...d, uniform: false }));

	const variation: ParamDef[] = [
		o.jitter === 'px'
			? P.float('rep_jitter', 'Position jitter', 0, 0, 1024, {
					softMax: 64,
					unit: 'px',
					step: 0.1,
					hint: 'Moves each instance randomly, up to this far from its place on each axis'
				})
			: P.float('rep_jit', 'Position jitter', 0, 0, 1, {
					step: 0.001,
					hint: 'Moves each instance randomly off its place, up to half a step at 1, for scattered medallions or uneven rune text'
				}),
		P.float('rep_rot', 'Rotation variation', 0, 0, 180, {
			unit: '°',
			step: 0.1,
			hint: 'Turns each instance randomly, up to this much either way'
		}),
		P.float('rep_rot_step', 'Rotation steps', 0, 0, 180, {
			softMax: 90,
			unit: '°',
			step: 0.1,
			showIf: (p) => Number(p.rep_rot) > 0,
			hint: 'Snaps the random turns to multiples of this angle (0 = any angle). For example, 90 with a Rotation variation of 180 gives each instance a random quarter turn, for notched tiles or hooks facing every way'
		}),
		P.enum(
			'rep_flip',
			'Flip at random',
			'none',
			[
				['none', 'None'],
				['x', 'Left / right'],
				['y', 'Up / down'],
				['both', 'Both']
			],
			{
				hint: 'Mirrors half the instances at random on each chosen axis, so lopsided shapes like a hooked curve or a notched corner face both ways'
			}
		),
		P.float('rep_scale', 'Size variation', 0, 0, 0.95, {
			step: 0.001,
			hint: o.scaleHint ?? 'Shrinks each instance randomly, by up to this fraction'
		}),
		P.float('rep_drop', 'Drop out', 0, 0, 1, {
			step: 0.001,
			hint: 'Removes this fraction of the instances at random'
		})
	];
	const place = P.enum(
		'rep_place',
		'Place',
		'grid',
		[
			['grid', 'Grid', 'in rows and columns'],
			[
				'mask',
				'Around a mask',
				'along the outline of a mask the layers before this one wrote: rivets round a plate, stitching round a patch'
			],
			['edges', 'Along the texture edges', 'along the four edges of the texture']
		],
		{
			optimize: false,
			hint: 'Picks where the repeats go: on a grid, along the outline of a mask, or along the texture’s edges'
		}
	);
	const rows = [place, ...grid.map((d) => ({ ...d, showIf: and(onGrid, d.showIf) })), ...outline, ...variation]
		.map((d) => ({ ...d, group, ...(o.defaults && d.key in o.defaults ? { default: o.defaults[d.key] } : {}) }))
		.map((d) => (without.has(d.key) ? { ...d, showIf: () => false, optimize: false } : d));
	return [...rows.flatMap((d) => [d, ...(o.after?.[d.key] ?? []).map((a) => ({ ...a, group }))]), P.seed()];
}

// ---------------------------------------------------------------- withRepeat

export interface RepeatHooks {
	/** Clear of the corners: at most how many of the family's instances fit on a side `len` px long (Tabs: by Length). */
	fit?: (params: ParamValues, len: number) => number;
}

/**
 * A repeating generator with the shared Repeat's outline side: the mask it follows (maskSource), the MASK_REPEAT shader
 * variant on an outline, and the instances there (prepare → t_rep_inst, t_rep_bucket). Its own prepare, maskSource,
 * textures and shader features are kept.
 */
export function withRepeat(def: LayerDef, hooks: RepeatHooks = {}): LayerDef {
	return {
		...def,
		textures: [...(def.textures ?? []), 'rep_inst', 'rep_bucket'],
		maskSource: (p) =>
			p.rep_place === 'mask' ? String(p.rep_mask ?? '').trim() || SHAPE_MASK : (def.maskSource?.(p) ?? null),
		shaderFeatures: (p) => [...(def.shaderFeatures?.(p) ?? []), ...(onOutline(p) ? ['MASK_REPEAT'] : [])],
		prepare: (ctx, layer) => ({ ...(def.prepare?.(ctx, layer) ?? {}), ...repeatPrepare(ctx, layer, hooks) })
	};
}

// The mask's distance less the Offset, four texels to one (a quarter-width target, so the readback is small), ±2 px
// at most — enough to place the crossing between two texels — and ±4 where the mask holds nothing / everything.
const PACK = /* glsl */ `
uniform sampler2D tDist;
uniform float uOff;
uniform int uW;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 o = vec4(4.0);
  for (int j = 0; j < 4; j++) {
    int x = 4 * c.x + j;
    float d = x < uW ? texelFetch(tDist, ivec2(x, c.y), 0).x : 1e4;
    o[j] = d >= 5e3 ? 4.0 : d <= -5e3 ? -4.0 : clamp(d - uOff, -2.0, 2.0);
  }
  oColor = o;
}
`;

interface Placed {
	key: string;
	/** What the layers before produced it from (upstreamKey), when that can be told from their params. */
	up: string | null;
	opts: string;
	inst: THREE.DataTexture;
	bucket: THREE.DataTexture;
}
/** The last placements per layer (two: a supersampled render and the editor's alternate). */
const placed = new Map<string, Placed[]>();

function floatTexture(data: Float32Array, width: number, height: number): THREE.DataTexture {
	const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
	t.minFilter = THREE.NearestFilter;
	t.magFilter = THREE.NearestFilter;
	t.colorSpace = THREE.NoColorSpace;
	t.needsUpdate = true;
	return t;
}

/** FNV-1a over a string's UTF-16 code units. */
function hashString(t: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(36) + ':' + t.length;
}

/**
 * What the mask a layer follows is made from: the layers before it (with the groups, base, seed and canvas) and the
 * mask's name and Offset — so an edit that leaves them alone (this layer's own size, colour, height) skips the readback.
 * Null when that can't be told from params: a layer before it draws an image, which may still be decoding.
 */
function upstreamKey(ctx: FilterContext, layer: Layer): string | null {
	const pr = ctx.project;
	const i = pr.layers.findIndex((l) => l.id === layer.id);
	if (i < 0) return null;
	const before = pr.layers.slice(0, i);
	if (before.some((l) => layerParamDefs(l.type).some((d) => d.type === 'image' && l.params[d.key]))) return null;
	const p = layer.params;
	return hashString(
		JSON.stringify([before, pr.groups ?? null, pr.base, pr.seed, ctx.width, ctx.height, pr.tileable, p.rep_mask, p.rep_off])
	);
}

/** FNV-1a over a float buffer's bits. */
function hashFloats(a: Float32Array): string {
	const u = new Uint32Array(a.buffer, a.byteOffset, a.length);
	let h = 0x811c9dc5;
	for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193);
	return (h >>> 0).toString(36) + ':' + u.length;
}

const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** The placement params, as outline.ts takes them. */
function placeOptions(p: ParamValues, hooks: RepeatHooks): PlaceOptions {
	return {
		along: p.rep_along === 'side' ? 'side' : 'outline',
		countBy: p.rep_count_by === 'spacing' ? 'spacing' : 'repeats',
		n: num(p.rep_n, 8),
		spacing: num(p.rep_space, 16),
		corners: p.rep_corners === 'clear' ? 'clear' : 'on',
		clear: num(p.rep_clear, 6),
		angle: num(p.rep_corner, 30),
		round: num(p.rep_round, 16),
		offset: num(p.rep_off, 0),
		shift: num(p.rep_shift, 0),
		faces: Math.max(
			0,
			FACES.findIndex(([k]) => k === p.rep_faces)
		),
		fit: hooks.fit ? (len) => hooks.fit!(p, len) : undefined,
		max: MAX_OUTLINE_INSTANCES
	};
}

/**
 * The instances along the outline (prepare, every evaluation): the mask's distance (exact, or by jump flood from its
 * coverage) less the Offset is packed and read back, traced, and the instances placed and bucketed. Reused while the
 * read-back field and the placement params stay the same. An empty mask (or one that covers everything) falls back to
 * the texture's edges.
 */
function repeatPrepare(ctx: FilterContext, layer: Layer, hooks: RepeatHooks): Record<string, THREE.Texture> {
	const p = layer.params;
	if (!onOutline(p)) return {};
	const W = ctx.width;
	const H = ctx.height;
	const tile = ctx.project.tileable;
	const off = num(p.rep_off, 0);
	const opts = placeOptions(p, hooks);
	const optsKey = JSON.stringify({ ...opts, fit: hooks.fit ? [hooks.fit(p, 97), hooks.fit(p, 1e4)] : 0 });
	const list = placed.get(layer.id) ?? [];
	// Nothing before it changed (an edit to this layer alone): the last placement stands, without reading the mask back.
	const up = p.rep_place === 'mask' ? upstreamKey(ctx, layer) : null;
	const same = up ? list.find((e) => e.up === up && e.opts === optsKey) : undefined;
	if (same) return { rep_inst: same.inst, rep_bucket: same.bucket };
	let field: Float32Array | null = null;
	let fieldKey = 'edges';
	if (p.rep_place === 'mask' && ctx.maskSource) {
		const src = ctx.maskSource;
		const dist = src.exact
			? src.texture
			: jumpFlood(ctx, {
					source: DISTANCE_SOURCE.mask,
					mask: src.texture,
					threshold: 0.5,
					maxDistance: Math.abs(off) + 4,
					relax: 2,
					name: 'rep-jfa'
				}).texture;
		const W4 = Math.ceil(W / 4);
		const mat = ctx.sharedMaterial('repeat:pack', PACK, {
			tDist: { value: null },
			uOff: { value: 0 },
			uW: { value: 0 }
		});
		mat.uniforms.tDist.value = dist;
		mat.uniforms.uOff.value = off;
		mat.uniforms.uW.value = W;
		const target = ctx.scratch('rep-pack', W4, H);
		ctx.run(mat, target);
		const packed = ctx.gpu.readTexture(target.texture, W4, H);
		fieldKey = hashFloats(packed);
		// Unpacked, and nothing there (all +4 or all −4: the mask holds nothing, or everything) → the texture's edges.
		const v = new Float32Array(W * H);
		let real = false;
		const first = packed[0];
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const f = packed[(y * W4 + (x >> 2)) * 4 + (x & 3)];
				v[y * W + x] = f;
				if (f !== first || Math.abs(f) < 3.5) real = true;
			}
		if (real) field = v;
		else fieldKey = 'edges';
	}
	const key = [W, H, tile, p.rep_place, fieldKey, optsKey].join('|');
	let hit = list.find((e) => e.key === key);
	if (!hit) {
		const outlines: Outline[] = field
			? traceOutlines({ width: W, height: H, tile, v: field })
			: canvasOutline(W, H, off);
		const b = bucketInstances(placeInstances(outlines, opts), W, H, tile);
		hit = {
			key,
			up,
			opts: optsKey,
			inst: floatTexture(b.inst, INST_ROW, b.instH),
			bucket: floatTexture(b.bucket, b.bucketW, b.bucketH)
		};
		list.unshift(hit);
		for (const old of list.splice(2)) {
			old.inst.dispose();
			old.bucket.dispose();
		}
		placed.set(layer.id, list);
	}
	return { rep_inst: hit.inst, rep_bucket: hit.bucket };
}
