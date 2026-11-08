// Params shared by every generator layer: SDF shape handling, value shaping, masking and the channel
// outputs (docs/architecture.md §5.2). They live flat in layer.params next to the type's own params.

import type { MaskSourceDef } from './types';
import { P, gradient, type GroupDef, type ParamDef, type ParamValues } from '@/core/params';

/** What drives a channel output (the uniform keeps the option order: 0 value, 1 flat, 2 random, 3 shape). */
const SRC: [string, string, string][] = [
	[
		'value',
		'Pattern',
		'the layer’s own value, like noise brightness or the bevel’s rise on a shape, so it varies across the layer'
	],
	['flat', 'Solid', 'full strength everywhere the layer covers: the gradient ramp’s end colour, the whole amount'],
	['random', 'Random', 'gives each brick, cell or shape instance a random value of its own'],
	[
		'shape',
		'Shape',
		'the layer’s shape without its pattern: 1 inside, 0 outside (anti-aliased). Handy for making Wood’s gaps rougher than its boards, ignoring the grain. 1 everywhere on layers without a shape'
	]
];

const SRC_HINT = 'Picks what drives this output';

// Masks (FR8.23): named, each a signed distance plus the random of the feature there. A layer writes one (Mask › Write
// to, shape layers default to the Shape mask) and is limited by an expression of them (Limit to). The mode is how the
// layer's shape or coverage combines with what the mask held. Option order matters: the index + 1 is sdfCombine's op.
export const SDF_OPS: [string, string][] = [
	['replace', 'Normal'],
	['union', 'Union'],
	['subtract', 'Subtract'],
	['intersect', 'Intersection'],
	['smooth-union', 'Smooth union'],
	['smooth-subtract', 'Smooth subtract'],
	['smooth-intersect', 'Smooth intersection']
];

export const PROFILES: [string, string][] = [
	['flat', 'Flat'],
	['linear', 'Linear'],
	['smooth', 'Smooth'],
	['round', 'Round'],
	['cove', 'Cove'],
	['ridge', 'Ridge'],
	['steps', 'Steps'],
	['custom', 'Custom curve']
];

/** Default custom bevel: steep for the first fifth of the bevel, then a long, gentle rise. */
export const DEFAULT_BEVEL_CURVE = {
	points: [
		{ x: 0, y: 0 },
		{ x: 0.15, y: 0.55 },
		{ x: 0.45, y: 0.82 },
		{ x: 1, y: 1 }
	]
};

/** The custom bevel curve param (shown when Profile = Custom curve). */
export const bevelCurveParam = (group?: string): ParamDef =>
	P.curve('bevel_curve', 'Bevel curve', DEFAULT_BEVEL_CURVE, {
		...(group ? { group } : {}),
		showIf: (p) => p.profile === 'custom',
		hint: 'Draws the bevel’s height (up) against distance into the shape (right, 0 = edge … 1 = bevel width). Points can rise and fall for raised rims or dished centres. Drag points, click to add one, double-click to remove one'
	});

/**
 * Shader prefix / suffix for layers with a custom bevel curve: profileCurve() in the common GLSL calls bevelCurve(),
 * which forwards to the curve_bevel_curve() emitted with the layer's uniforms.
 */
export const bevelCurveDefine = (defs: ParamDef[]) =>
	defs.some((d) => d.key === 'bevel_curve') ? '#define BEVEL_CURVE\n' : '';
export const bevelCurveImpl = (defs: ParamDef[]) =>
	defs.some((d) => d.key === 'bevel_curve') ? 'float bevelCurve(float x) { return curve_bevel_curve(x); }\n' : '';

export const BLEND_MODES: [string, string][] = [
	['normal', 'Normal'],
	['multiply', 'Multiply'],
	['screen', 'Screen'],
	['overlay', 'Overlay'],
	['add', 'Add'],
	['subtract', 'Subtract'],
	['darken', 'Darken'],
	['lighten', 'Lighten'],
	['softlight', 'Soft light']
];

/** Write to's rows (FR8.23): row 1 keeps the plain keys (mk_target …), row n > 1 adds `_n`. */
export const MAX_WRITE_ROWS = 12;
export const rowKey = (base: string, n: number) => (n === 1 ? base : `${base}_${n}`);
/** The row a Write to key belongs to (`mk_target_3` → 3). */
export const rowOf = (key: string) => Number(/_(\d+)$/.exec(key)?.[1] ?? 1);
export const rowTarget = (p: Record<string, unknown>, n: number) => String(p[rowKey('mk_target', n)] ?? '').trim();

/** The Source dropdown of a channel output, drawn in one row with its blend mode. */
const source = (key: string, group: string, mode: string, modeLabel = 'Mode'): ParamDef =>
	P.enum(key, 'Source', 'value', SRC, {
		group,
		hint: SRC_HINT,
		join: { with: mode, as: 'pair', label: `Source · ${modeLabel}` }
	});

/** "At 0" / "At 1" of a scalar output, drawn as one ramp. */
const ramp = (key: string, group: string) => ({ join: { with: key, as: 'ramp' as const, label: 'Ramp' }, group });

/** Height › Mode, in heightCombine's order (glsl/common.ts). */
export const HEIGHT_MODES: [string, string, string][] = [
	['add', 'Add', 'raises by the amount'],
	['subtract', 'Subtract', 'sinks by the amount'],
	['max', 'Max', 'raises to the amount where it’s lower (caps, plateaus)'],
	['min', 'Min', 'lowers to the amount where it’s higher (chips, cut-offs)'],
	['replace', 'Replace', 'sets the height to the amount'],
	['multiply', 'Multiply', 'scales the height below (masks relief in and out)']
];
const LEVEL_MODES: [string, string][] = [
	['replace', 'Replace'],
	['multiply', 'Multiply'],
	['add', 'Add'],
	['min', 'Min'],
	['max', 'Max']
];

/**
 * Mask card › Write to (FR8.23): up to MAX_WRITE_ROWS rows, each a Source (what of the layer: itself, a part, an output —
 * the options come from the type, LayerDef.maskSources) into a Target mask, by a Mode, with its own Smoothness and
 * Feather. The registry gives each of the type's sources a row of its own, shown from the start (row n's Source defaults
 * to the nth source); rows past them are added ones (Write to › Add mask). An empty row writes nothing. Shape layers
 * write their shape (a distance, and the random of each feature) and default row 1 to the Shape mask; other generators write their coverage. Row 1's Mode, Smoothness and
 * Feather drive the layer's own pass (uniforms); the other rows run as passes of their own with theirs (masks.ts).
 */
export const MASK_WRITE_PARAMS: ParamDef[] = Array.from({ length: MAX_WRITE_ROWS }, (_, i): ParamDef[] => {
	const n = i + 1;
	const first = n === 1;
	const shown = (p: Record<string, unknown>) => first || rowTarget(p, n - 1) !== '';
	const writes = (p: Record<string, unknown>) => rowTarget(p, n) !== '';
	const smooth = (p: Record<string, unknown>) => String(p[rowKey('mk_op', n)]).startsWith('smooth');
	const base = { group: 'mask', section: 'Write to', ...(first ? {} : { uniform: false, optimize: false }) };
	return [
		P.enum(rowKey('mk_src', n), first ? 'Source' : `Source ${n}`, 'layer', [['layer', 'This layer']], {
			...base,
			uniform: false,
			optimize: false,
			showIf: shown,
			hint: 'Picks what of this layer goes into the mask: the layer as drawn, one of its parts, or one of its outputs (as a copy of the layer set to that output would draw it). A shape writes its distance, a gradient writes a soft coverage'
		}),
		P.text(rowKey('mk_target', n), first ? 'Target' : `Target ${n}`, '', {
			...base,
			mask: 'write',
			showIf: shown,
			hint: first
				? 'Names the mask this row writes. A shape layer writes its shape (and which feature is where), any other layer writes where it covers. Later layers can be limited to it (Limit to), bevel or etch along it, or read its features (Mask area). Shape layers write the Shape mask unless you change it (empty = none)'
				: 'Writes one more mask by name, from the Source on its left (empty = none)'
		}),
		P.enum(rowKey('mk_op', n), 'Mode', 'replace', SDF_OPS, {
			...base,
			showIf: writes,
			hint: 'Sets how this combines with what the mask already holds. Normal: replaces it. Union: adds to it. Subtract: cuts this out of it. Intersection: keeps only the overlap. Smooth: blends them with a rounded fillet. A shape layer draws the combined shape in every mode (of its first row)'
		}),
		P.float(rowKey('mk_smooth', n), 'Smoothness', 4, 0, 256, {
			...base,
			softMax: 32,
			unit: 'px',
			step: 0.1,
			showIf: (p) => writes(p) && smooth(p),
			hint: 'Sets how wide the rounded fillet is where this meets what the mask held (smooth modes)'
		}),
		P.float(rowKey('mk_feather', n), 'Feather', 0, 0, 1024, {
			...base,
			softMax: 32,
			unit: 'px',
			step: 0.1,
			showIf: writes,
			hint: "Softens the written mask's edge, fading it out over this width across a shape's outline (shapes only). Other layers soften with Shaping › Cutoff softness"
		})
	];
}).flat();

/** Every key of Write to's rows. */
export const WRITE_ROW_KEYS = new Set(MASK_WRITE_PARAMS.map((p) => p.key));

/**
 * A generator's parts for its masks (Greebles, Vents, Pipes, Trim): the enum `key` its shader reads to pick the shape that
 * goes to the mask (hidden — Write to › Source picks it; its 'none' kept for stored values), and one Source per part,
 * `main` (it rides in the layer's own pass), the default first.
 */
export function maskParts(
	key: string,
	def: string,
	options: ([string, string] | [string, string, string])[]
): { param: ParamDef; sources: MaskSourceDef[] } {
	const param = P.enum(key, 'Shape for the mask', def, [['none', 'None'], ...options], {
		showIf: () => false,
		optimize: false,
		hint: 'Set by Mask › Write to › Source'
	});
	const ordered = [...options.filter((o) => o[0] === def), ...options.filter((o) => o[0] !== def)];
	const sources = ordered.map(([value, label, hint]) => ({
		value,
		label,
		...(hint ? { hint } : {}),
		params: { [key]: value },
		main: true
	}));
	return { param, sources };
}

/**
 * GLSL (generator shaders, after the param uniforms): what the layer writes into its mask (uMaskKind: 0 nothing, 1 its
 * shape, 2 its coverage) and how its shape combines there — maskOp() is mk_op's option index + 1, the sdfCombine op
 * (1 replaces, 2 union …; SDF_OPS keeps that order), or 0 when it writes no shape.
 */
export const GLSL_MASK_OP = /* glsl */ `
uniform int uMaskKind;
// A coverage write takes the output's value too (a soft write: an output's gradient, Write to › Source).
uniform bool uMaskSoft;
int maskOp() { return uMaskKind == 1 ? u_mk_op + 1 : 0; }
`;

/** Most masks a Limit to expression combines. */
export const MAX_LIMIT_TERMS = 4;

export const LIMIT_OPS: [string, string, string][] = [
	['and', 'And', 'keeps only where both are (intersection)'],
	['or', 'Or', 'keeps where either is (union)'],
	['minus', 'Except', 'leaves out where the next mask is, cutting it out of the ones before']
];

/**
 * Mask card › Limit to (FR8.23), for generators and filters: up to four masks by name, read left to right (lim_1, then
 * lim_op2 lim_2 …), Invert turning the result inside out. Not uploaded: the pipeline combines the masks into one limit.
 */
export const LIMIT_PARAMS: ParamDef[] = [
	...Array.from({ length: MAX_LIMIT_TERMS }, (_, i): ParamDef[] => {
		const n = i + 1;
		const shown = (p: Record<string, unknown>) => i === 0 || String(p[`lim_${i}`] ?? '').trim() !== '';
		const name = P.text(`lim_${n}`, i === 0 ? 'Limit to' : `Mask ${n}`, '', {
			group: 'mask',
			section: 'Limit to',
			mask: 'read',
			bare: i > 0,
			showIf: shown,
			hint:
				i === 0
					? "Draws this layer only where a mask is (or, with Invert, isn't). Pick a mask written by a layer above, by name; Shape is the one shape layers write (empty = anywhere)"
					: 'Adds one more mask, joined to the ones before by the operator'
		});
		if (i === 0) return [name];
		// Between two masks: And / Or / Except buttons, then the next mask's field.
		return [
			P.enum(`lim_op${n}`, 'Join', 'and', LIMIT_OPS, {
				group: 'mask',
				section: 'Limit to',
				uniform: false,
				showIf: shown,
				segmented: true,
				bare: true,
				hint: 'Sets how the next mask joins the ones before'
			}),
			name
		];
	}).flat(),
	P.bool('lim_out', 'Invert', false, {
		group: 'mask',
		section: 'Limit to',
		uniform: false,
		showIf: (p) => String(p.lim_1 ?? '').trim() !== '',
		hint: 'Flips the masks round, so the layer draws only where they aren’t, like grout between the tiles or a hole cut through'
	})
];

export const SDF_PARAMS: ParamDef[] = [
	P.float('bevel', 'Bevel', 3, 0, 1024, { softMax: 64, unit: 'px', step: 0.1, group: 'shaping', section: 'Edge' }),
	P.enum('profile', 'Profile', 'round', PROFILES, { group: 'shaping', section: 'Edge' }),
	{ ...bevelCurveParam('shaping'), section: 'Edge' },
	P.bool('bevel_aspect_on', 'Custom bevel aspect', false, {
		uniform: false,
		optimize: false,
		group: 'shaping',
		section: 'Edge',
		showIf: (p) => Number(p.bevel) > 0 && p.profile !== 'flat',
		hint: 'Gives the top and bottom bevels a different width from the left and right. Needs a variant of the shader, compiled the first time'
	}),
	P.float('bevel_aspect', 'Bevel aspect', 1, 0.05, 20, {
		gate: { by: 'bevel_aspect_on', off: 1 },
		softMin: 0.25,
		softMax: 4,
		step: 0.01,
		group: 'shaping',
		section: 'Edge',
		showIf: (p) => p.bevel_aspect_on === true && Number(p.bevel) > 0 && p.profile !== 'flat',
		hint: 'Trades the top / bottom bevel width against left / right, keeping Bevel as their geometric mean. 2 makes top and bottom bevels 1.41× Bevel and left and right 0.71× (the ends of vertical planks round off twice as far in as their sides), 0.5 the reverse. Slanted edges and corners fall in between'
	}),
	P.bool('aa', 'Anti-alias', true, {
		group: 'shaping',
		section: 'Edge',
		hint: 'Smooths the edges (off = hard pixel edges)'
	}),
	P.float('soft_edge', 'Soft edge', 0, 0, 256, {
		softMax: 16,
		unit: 'px',
		step: 0.1,
		group: 'shaping',
		section: 'Edge',
		hint: 'Fades the layer in over this far inside its outline, blending colour, height and every other channel into what’s under it. The shape (and the mask it writes) stays where it is'
	}),
	P.float('dilate', 'Dilate', 0, 0, 256, {
		softMax: 16,
		unit: 'px',
		step: 0.1,
		group: 'shaping',
		section: 'Edge',
		hint: 'Grows the shape outwards by this far, both what it draws and the mask it writes'
	})
];

/** The Edge card of a mask-only SDF layer (sdf: 'mask'): no bevel until asked for. */
export const MASK_SDF_PARAMS: ParamDef[] = SDF_PARAMS.map((p) => (p.key === 'bevel' ? { ...p, default: 0 } : p));

/**
 * GLSL for SDF layers (needs their u_bevel, u_bevel_aspect, u_profile): the bevel profile at signed distance d (px,
 * < 0 inside) with screen-space gradient g — 0 at the edge rising to 1 a bevel in. Bevel aspect a makes left / right
 * bevels Bevel / √a and top / bottom ones Bevel · √a; an edge with unit normal n gets the width the bevel has across it
 * in that stretched space, √((nx·Wx)² + (ny·Wy)²). 1 everywhere for a flat profile or no bevel (coverage anti-aliases).
 *
 * Taken from the distance's own direction, the width jumps where that direction does — on the mitre where two edges
 * meet at a corner, a visible step in the bevel. The exact bevel is the plain distance in the space the aspect
 * stretches (screen axes × Bevel / their width; bevelFrame maps a feature's local frame there), to the outline piece by
 * piece: bevelSeg2 for straight pieces, bevelArc2 for circular arcs and bevelEllipse for whole ellipses (circles and
 * ellipses stay ellipses, stretched). The least over the pieces, signed by the generator's own inside test, goes to
 * GenOut.bdist (px of Bevel): continuous, its mitres leaning towards the narrower bevel. (bevelLine(d, n) is one
 * straight edge's term on its own: the same over the whole line.)
 */
export const GLSL_BEVEL = /* glsl */ `
vec2 bevelWidths() { float r = sqrt(max(u_bevel_aspect, 1e-3)); return u_bevel * vec2(1.0 / r, r); }
// The bevel's width across an edge with screen normal n (any length; screen axes, either sign).
float bevelWidth(vec2 n) {
  float nn = dot(n, n);
  vec2 n2 = nn > 1e-12 ? n * n / nn : vec2(0.5);
  vec2 W = bevelWidths();
  return max(sqrt(dot(n2, W * W)), 1e-4);
}
// A distance d (px, negative inside) across an edge with screen normal n, in px of Bevel: the same share of a bevel in.
float bevelLine(float d, vec2 n) { return d * u_bevel / bevelWidth(n); }
// The bevel profile x bevels in from the edge (0 … 1); 1 everywhere for no bevel or a flat profile.
float bevelProfile(float x) { return (u_bevel <= 0.0 || u_profile == 0) ? 1.0 : profileCurve(u_profile, x); }
// The bevel at a distance bd in px of Bevel (GenOut.bdist, bevelLine): what a generator's own bevel distance gives.
float bevelPlain(float bd) { return bevelProfile(max(-bd, 0.0) / u_bevel); }
// The bevel's rise at a distance d (px, negative inside), as the wrapper draws it: the profile in from the edge, or for
// no bevel or a flat profile 1 inside, 0 outside (bevelPlain: 1 everywhere). Stamp's levels, Polyline's stacked lines.
float bevelRise(float d) {
  return u_bevel <= 0.0 || u_profile == 0 ? (d <= 0.0 ? 1.0 : 0.0) : profileCurve(u_profile, max(-d, 0.0) / u_bevel);
}
// The bevel at a distance d (px) whose screen gradient g picks the width (Bevel aspect).
float bevelAt(float d, vec2 g) { return bevelProfile(max(-d, 0.0) / bevelWidth(g)); }
// Edge › Dilate: the shape grown outwards (its distances shifted), its coverage reaching the new outline.
void dilateShape(inout GenOut g, inout float cov) {
  if (u_dilate <= 0.0 || g.sdf <= NO_SDF) return;
  g.sdf -= u_dilate;
  if (g.bdist > NO_SDF) g.bdist -= u_dilate;
  cov = max(cov, coverage(g.sdf, u_aa));
}
// Edge › Soft edge: the layer fading in from its outline (d = 0.5, where anti-aliasing reaches 0) to full a Soft edge
// inside; 1 at 0.
float softEdge(float d) { return u_soft_edge > 0.0 ? 1.0 - smoothstep(0.5 - u_soft_edge, 0.5, d) : 1.0; }
// Whether the exact stretched bevels run: a Bevel and an aspect other than 1. Only the shader variant compiled for such a
// layer (BEVEL_ASPECT) has them at all; at aspect 1 the plain bevel is the same, so the default compile carries none of
// that code.
#ifdef BEVEL_ASPECT
bool bevelAspectOn() { return u_bevel > 0.0 && u_bevel_aspect != 1.0; }
#else
bool bevelAspectOn() { return false; }
#endif
// Local frame → the stretched space: a feature whose local x and y axes point along screen directions ax, ay (unit, with
// any flips). Points and offsets map alike (apply it to differences from the same origin).
mat2 bevelFrame(vec2 ax, vec2 ay) {
  vec2 k = u_bevel / bevelWidths();
  return mat2(ax * k, ay * k);
}
// Squared distance from p to the segment ab (all in the stretched space).
float bevelSeg2(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  vec2 v = pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
  return dot(v, v);
}
// Distance from p (stretched, local origin taken off) to the whole ellipse with local semi-axes ab along the local axes,
// mapped by M (bevelFrame): still an ellipse, its axes from the singular values of M·diag(ab) (2×2 closed form), the
// nearest point on it by ellipseNearest (GLSL_SDF).
float bevelEllipse(vec2 p, mat2 M, vec2 ab) {
  mat2 A = M * mat2(ab.x, 0.0, 0.0, ab.y);
  float E = (A[0][0] + A[1][1]) * 0.5, F = (A[0][0] - A[1][1]) * 0.5;
  float G = (A[0][1] + A[1][0]) * 0.5, H = (A[0][1] - A[1][0]) * 0.5;
  float Q = sqrt(E * E + H * H), R = sqrt(F * F + G * G);
  float phi = (atan(H, E) + atan(G, F)) * 0.5;
  vec2 e = max(vec2(Q + R, abs(Q - R)), vec2(1e-4));
  vec2 cu = vec2(cos(phi), sin(phi));
  vec2 pa = abs(vec2(dot(p, cu), dot(p, vec2(-cu.y, cu.x))));
  if (abs(e.x - e.y) < 1e-4 * e.x) return abs(length(pa) - e.x);
  return length(pa - ellipseNearest(pa, e));
}
// The same, signed (negative inside), from v: the local offset from the centre (not yet mapped by M).
float bevelEllipseS(vec2 v, mat2 M, vec2 ab) {
  float e = bevelEllipse(M * v, M, ab);
  return length(v / ab) < 1.0 ? -e : e;
}
// A capsule round the segment from a to a + ba, half width w, at pa = p − a: x its distance, y (with Bevel aspect) the
// same in px of Bevel (bevelLine: the sides by their normal, the caps by their direction; F maps local directions to
// the screen, mat2(1.0) on screen).
vec2 bevelCapsule(vec2 pa, vec2 ba, float w, mat2 F) {
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  vec2 v = pa - ba * h;
  float d = length(v) - w;
  return vec2(d, bevelAspectOn() ? bevelLine(d, F * (h > 0.0 && h < 1.0 ? vec2(-ba.y, ba.x) : v)) : d);
}
// Squared distance from p (stretched) to an arc of the circle with local centre c and radius r, mapped by M (bevelFrame,
// with the local origin already taken off p): from direction d0 to d1 (unit, local) the way round through m, its middle
// direction (d0 = d1 = −m: the whole circle). Stretched, the circle is an ellipse; chords of at most 0.2 rad of the
// circle (2 to 32 of them: 8 on a quarter arc, 16 on a semicircle) follow it within 0.5 % of the radius (an exact
// nearest point on the whole ellipse can lie off the arc, inside a large corner).
float bevelArc2(vec2 p, mat2 M, vec2 c, float r, vec2 d0, vec2 d1, vec2 m) {
  float ha = acos(clamp(dot(d0, m), -1.0, 1.0));
  int n = clamp(int(ceil(ha * 10.0 - 1e-3)), 2, 32);
  mat2 turn = rot2(2.0 * ha * (d0.x * m.y - d0.y * m.x < 0.0 ? -1.0 : 1.0) / float(n));
  vec2 u = d0;
  vec2 a = M * (c + r * u);
  float best = dot(p - a, p - a);
  for (int i = 0; i < n; i++) {
    u = turn * u;
    vec2 b = M * (c + r * u);
    best = min(best, bevelSeg2(p, a, b));
    a = b;
  }
  return best;
}
`;

export const SHAPING_PARAMS: ParamDef[] = [
	P.float('ofs_x', 'Offset X', 0, -4096, 4096, {
		softMin: -32,
		softMax: 32,
		sliderSpan: 'width',
		unit: 'px',
		step: 0.1,
		group: 'shaping',
		section: 'Position',
		hint: 'Shifts the whole pattern sideways (wraps on tileable projects)'
	}),
	P.float('ofs_y', 'Offset Y', 0, -4096, 4096, {
		softMin: -32,
		softMax: 32,
		sliderSpan: 'height',
		unit: 'px',
		step: 0.1,
		group: 'shaping',
		section: 'Position',
		hint: 'Shifts the whole pattern down'
	}),
	P.float('dw_amount', 'Domain warp', 0, 0, 256, {
		softMax: 8,
		unit: 'px',
		step: 0.05,
		group: 'shaping',
		section: 'Position',
		hint: 'Pushes the whole pattern around with smooth noise after it’s generated, so joints wander but keep their width'
	}),
	P.float('dw_scale', 'Domain warp scale', 4, 0.25, 128, {
		softMax: 32,
		step: 0.01,
		group: 'shaping',
		section: 'Position',
		showIf: (p) => Number(p.dw_amount) > 0,
		hint: 'Sets how many warp swirls fit across the texture (rounded when tiling)'
	}),
	P.bool('sh_invert', 'Invert', false, { group: 'shaping', section: 'Value' }),
	P.float('sh_lo', 'Low', 0, 0, 1, {
		step: 0.001,
		group: 'shaping',
		section: 'Value',
		join: { with: 'sh_hi', as: 'pair', label: 'Levels' },
		hint: 'Turns values at or below Low into 0 (raise it to drop the faint parts)'
	}),
	P.float('sh_hi', 'High', 1, 0, 1, {
		step: 0.001,
		group: 'shaping',
		section: 'Value',
		hint: 'Turns values at or above High into 1 (lower it to push more of the pattern to full)'
	}),
	P.float('sh_gamma', 'Gamma', 1, 0.05, 20, {
		softMin: 0.2,
		softMax: 5,
		step: 0.01,
		group: 'shaping',
		section: 'Value'
	}),
	P.int('sh_steps', 'Posterize', 0, 0, 64, {
		softMax: 16,
		group: 'shaping',
		section: 'Value',
		hint: 'Cuts the value into this many flat steps (0 = off)'
	}),
	P.float('sh_cut', 'Cutoff', 0, 0, 1, {
		step: 0.001,
		group: 'shaping',
		section: 'Value',
		hint: 'Covers only where the shaped value is at or above the cutoff (0 = off). Makes sparse flecks from white noise, islands from clouds'
	}),
	P.float('sh_cut_soft', 'Cutoff softness', 0, 0, 0.5, {
		step: 0.001,
		group: 'shaping',
		section: 'Value',
		showIf: (p) => Number(p.sh_cut) > 0
	})
];

/**
 * Column / Row spacing of a grid of separate objects (repeat grids, vent slots, tread plate, tabs on cells): the step
 * between neighbours grows (or, below 0, shrinks) by a share of the texture — 1 = a whole width / height more. The grid
 * stays centred; on a tileable texture, instances pushed past an edge come round the other side. repPitch / repGrid
 * (glsl/common.ts) lay it out.
 */
export const spacingParams = (extra: Pick<ParamDef, 'group' | 'showIf'> = {}): ParamDef[] => [
	P.float('col_sp', 'Column spacing', 0, -1, 1, {
		step: 0.001,
		...extra,
		hint: 'Pushes the columns apart (or, below 0, pulls them together) by this share of the texture width (1 = a whole width more between neighbours). The grid stays centred, and when tiling, columns pushed past an edge come round the other side'
	}),
	P.float('row_sp', 'Row spacing', 0, -1, 1, {
		step: 0.001,
		...extra,
		hint: 'Pushes the rows apart (or, below 0, pulls them together) by this share of the texture height (1 = a whole height more between neighbours). The grid stays centred, and when tiling, rows pushed past an edge come round the other side'
	})
];

const PHASE_HINT =
	'Animates the noise: 0 → 1 is one seamless loop (render frames at even steps), and it repeats beyond 1';

/** Phase of a noise-driven pattern (LayerDef.noise), in its Pattern card. Every generator has a `phase`. */
export const PHASE_PARAM: ParamDef = P.float('phase', 'Phase', 0, -10000, 10000, {
	softMin: 0,
	softMax: 1,
	step: 0.001,
	optimize: false,
	hint: PHASE_HINT
});

/**
 * The same for other generators, in Shaping: it moves their domain warp (and a type's own warp or wobble — by convention
 * a type param named `warp` or `wobble` whose 0 means off shows it too).
 */
export const WARP_PHASE_PARAM: ParamDef = P.float('phase', 'Warp phase', 0, -10000, 10000, {
	softMin: 0,
	softMax: 1,
	step: 0.001,
	optimize: false,
	group: 'shaping',
	section: 'Position',
	showIf: (p) => Number(p.dw_amount) > 0 || Number(p.warp ?? 0) > 0 || Number(p.wobble ?? 0) > 0,
	hint: 'Animates the domain warp: 0 → 1 is one seamless loop, and it repeats beyond 1'
});

/**
 * Not a control: 1 px of the texture in shader px (outputPx: supersampling scales it, resizing the canvas doesn't), for a
 * generator's lengths fixed in output pixels — the finest details, the safeguards against pixel-wide cliffs.
 */
export const PX_SCALE_PARAM: ParamDef = P.float('px_scale', 'Pixel scale', 1, 1, 8, {
	unit: 'px',
	outputPx: true,
	step: 1,
	optimize: false,
	showIf: () => false
});

/** Relief › Surface grain and its size (px): fine grainy unevenness over every face (Rock, Stone blocks). */
export const roughnessParams = (rough: number, scale: number): ParamDef[] => [
	P.float('rough', 'Surface grain', rough, 0, 1, {
		step: 0.001,
		section: 'Relief',
		hint: 'Adds fine grainy unevenness over every face'
	}),
	P.float('rough_scale', 'Grain size', scale, 1, 64, {
		softMax: 16,
		unit: 'px',
		step: 0.05,
		section: 'Relief',
		showIf: (p) => Number(p.rough) > 0
	})
];

/** A showIf: the layer's `mode` is one of these. */
export const modeIs =
	(...m: string[]) =>
	(p: Record<string, unknown>) =>
		m.includes(String(p.mode));

export const MASK_PARAMS: ParamDef[] = [
	P.float('opacity', 'Strength', 1, 0, 1, {
		step: 0.001,
		group: 'mask',
		hint: "Sets how much of this layer shows by scaling everything it writes (colour, height, roughness, specular, glow) at once (1 = full, 0.5 = half way from what was beneath, 0 = no effect). This isn't the Opacity output, which writes the texture's alpha"
	}),
	...LIMIT_PARAMS,
	...MASK_WRITE_PARAMS,
	P.enum(
		'm_hmode',
		'Height',
		'none',
		[
			['none', 'Anywhere', "the height doesn't limit this layer"],
			[
				'above',
				'Above the level',
				'draws only where the surface stands higher, for wear, highlights, dust on the tops'
			],
			['below', 'Below the level', 'draws only where it lies lower, for dirt, water, moss in the hollows and joints']
		],
		{
			group: 'mask',
			section: 'Height mask',
			hint: 'Limits this layer by the height of the surface the layers before it built, to only above or only below a level'
		}
	),
	P.float('m_hlevel', 'Level', 0.5, -16, 16, {
		softMin: 0,
		softMax: 1,
		step: 0.001,
		group: 'mask',
		section: 'Height mask',
		showIf: (p) => p.m_hmode !== 'none',
		hint: "Sets the height that divides above from below, in height units (1 = the project's Height depth in px; the base starts at its own Height, 0 by default). The viewport's Hgt view shows the heights"
	}),
	P.float('m_hsoft', 'Softness', 0.1, 0, 4, {
		softMax: 1,
		step: 0.001,
		group: 'mask',
		section: 'Height mask',
		showIf: (p) => p.m_hmode !== 'none',
		hint: 'Fades the layer in gradually across the level, over this many height units either side of it (0 = a hard cut)'
	})
];

/**
 * Roughness / Specular / Metalness: a level from the source along a ramp (At 0 … At 1), blended in by a LEVEL_MODES
 * mode. A Solid source is 1 everywhere, so it shows only At 1, as one Level slider.
 */
const levelOutput = (prefix: string, group: string, label: string, a: number, b: number, hintA: string): ParamDef[] => {
	const solid = (p: ParamValues) => p[`${prefix}_src`] === 'flat';
	return [
		P.bool(`${prefix}_on`, label, false, { group }),
		source(`${prefix}_src`, group, `${prefix}_mode`),
		P.enum(`${prefix}_mode`, 'Mode', 'replace', LEVEL_MODES, { group }),
		P.float(`${prefix}_a`, 'At 0', a, 0, 1, {
			step: 0.001,
			...ramp(`${prefix}_b`, group),
			hint: hintA,
			showIf: (p) => !solid(p)
		}),
		P.float(`${prefix}_b`, 'At 1', b, 0, 1, {
			step: 0.001,
			group,
			labelFor: (p) => (solid(p) ? 'Level' : 'At 1'),
			hint: `With Source Solid, sets the ${label.toLowerCase()} wherever the layer covers`
		}),
		P.float(`${prefix}_opacity`, 'Opacity', 1, 0, 1, { step: 0.001, group })
	];
};

/** Every channel output's Source. */
export const SRC_KEYS = ['dif_src', 'h_src', 'r_src', 's_src', 'mt_src', 'e_src'];

/** The sources that take the Parts option on a generator with its own per-part levels (LayerDef.parts; srcLevel). */
export const PARTS_SRC_KEYS = ['r_src', 's_src', 'mt_src', 'e_src'];

export const OUTPUT_PARAMS: ParamDef[] = [
	P.bool('dif_on', 'Diffuse', false, { group: 'diffuse' }),
	source('dif_src', 'diffuse', 'dif_blend', 'Blend'),
	P.enum('dif_blend', 'Blend', 'normal', BLEND_MODES, {
		group: 'diffuse',
		hint: 'Sets how the colour mixes with the layers below'
	}),
	P.float('dif_opacity', 'Opacity', 1, 0, 1, { step: 0.001, group: 'diffuse' }),
	P.gradient('dif_grad', 'Colour ramp', gradient('#2a2622', '#b8ab98'), {
		group: 'diffuse',
		hint: 'Maps the source to a colour along the gradient ramp (0 = left end, 1 = right end)'
	}),
	P.float('dif_jitter', 'Colour variation', 0, 0, 1, {
		step: 0.001,
		group: 'diffuse',
		hint: 'Shifts each feature (brick, cell, instance) randomly along the gradient ramp'
	}),

	P.bool('op_on', 'Opacity', false, { group: 'alpha' }),
	P.enum(
		'op_mode',
		'Mode',
		'replace',
		[
			['replace', 'Replace'],
			['multiply', 'Multiply'],
			['union', 'Union (max)'],
			['subtract', 'Subtract']
		],
		{ group: 'alpha' }
	),

	P.bool('h_on', 'Height', false, { group: 'height' }),
	source('h_src', 'height', 'h_mode'),
	P.enum('h_mode', 'Mode', 'add', HEIGHT_MODES, {
		group: 'height',
		hint: 'Sets how the height combines with the surface below'
	}),
	P.float('h_amount', 'Amount', 0.5, -64, 64, {
		softMin: 0,
		softMax: 2,
		step: 0.001,
		group: 'height',
		hint: 'Sets the height at a source of 1 (1.0 = the project’s height depth in px)'
	}),
	P.float('h_offset', 'Offset', 0, -64, 64, {
		softMin: -1,
		softMax: 1,
		step: 0.001,
		optimize: false,
		group: 'height',
		hint: 'Raises (or, below 0, sinks) the whole height output by this much, in the units of Amount, so the height is Offset at a source of 0 and Offset + Amount at 1. Lifts one layer’s relief above another’s without squashing its range. Applies wherever the layer covers'
	}),
	P.float('h_var', 'Per-feature variation', 0, 0, 1, {
		step: 0.001,
		group: 'height',
		hint: 'Gives each brick / cell / instance a random share of the amount (0 = all the same, 1 = anywhere from 0 to full), so some are barely raised and others bold. No effect on patterns without features (smooth noise, clouds)'
	}),

	...levelOutput(
		'r',
		'roughness',
		'Roughness',
		0.35,
		0.85,
		'Sets the roughness where the source is 0 (left) and 1 (right): 0 = glossy … 1 = matte'
	),
	...levelOutput(
		's',
		'specular',
		'Specular',
		0,
		0.6,
		'Sets the specular level where the source is 0 (left) and 1 (right); 0.5 ≈ 4 % reflectance at scale 1'
	),
	...levelOutput(
		'mt',
		'metalness',
		'Metalness',
		0,
		1,
		'Sets the metalness where the source is 0 (left) and 1 (right): 0 = non-metal … 1 = metal. Metal reflects in its diffuse colour (give metals a bright one: copper ≈ #c87850) and has no diffuse shading'
	),

	P.bool('e_on', 'Emissive', false, { group: 'emissive' }),
	source('e_src', 'emissive', 'e_mode'),
	P.enum(
		'e_mode',
		'Mode',
		'add',
		[
			['add', 'Add'],
			['replace', 'Replace'],
			['max', 'Max']
		],
		{ group: 'emissive' }
	),
	P.color('e_color', 'Colour', '#ff9019', { group: 'emissive' }),
	P.float('e_intensity', 'Intensity', 2, 0, 1000, {
		softMax: 20,
		step: 0.01,
		group: 'emissive',
		hint: 'Sets the emitted light at a source of 1 (HDR: above 1 glows past white)'
	})
];

export const GENERATOR_GROUPS: GroupDef[] = [
	{ id: 'params', label: 'Pattern' },
	// Shaping: the shape's edge (bevel, profile, anti-alias), where the pattern sits (offset, warp) and its value (levels,
	// gamma, posterize, invert, cutoff) — the chain that makes the layer's value.
	{ id: 'shaping', label: 'Shaping' },
	{ id: 'mask', label: 'Mask', collapsed: true },
	{ id: 'diffuse', label: 'Diffuse', toggleKey: 'dif_on' },
	{ id: 'alpha', label: 'Opacity', toggleKey: 'op_on' },
	{ id: 'height', label: 'Height', toggleKey: 'h_on' },
	{ id: 'roughness', label: 'Roughness', toggleKey: 'r_on' },
	{ id: 'specular', label: 'Specular', toggleKey: 's_on' },
	{ id: 'metalness', label: 'Metalness', toggleKey: 'mt_on' },
	{ id: 'emissive', label: 'Emissive', toggleKey: 'e_on' }
];

export const FILTER_GROUPS: GroupDef[] = [
	{ id: 'params', label: 'Filter' },
	{ id: 'mask', label: 'Mask', collapsed: true }
];

/**
 * The wrapper's shape d: the generator's distance combined with the mask it writes by the Mode (Mask › Write to; index + 1
 * = sdfCombine op, 0 = writes none, which keeps g.sdf), and that write.
 */
const SHAPE_COMBINE = /* glsl */ `int op = maskOp();
  float d = sdfCombine(op, prevDist, g.sdf, u_mk_smooth);`;
const SHAPE_MASK_WRITE = /* glsl */ `if (op != 0) {
      maskOut = maskTexel(op, d, g.sdf, g.fid, maskPrev);
      // Feather stores a soft ramp across the outline instead of the distance (its coverage reads back the same way).
      if (u_mk_feather > 0.0) maskOut.x = clamp(d / u_mk_feather, -0.5, 0.5);
    }`;

/** GLSL for the generator wrapper's use of the common params (declared automatically from the defs above). */
export const GLSL_GENERATOR_MAIN = (sdf: boolean | 'mask') => /* glsl */ `

float shapeValue(float v) {
  v = clamp((v - u_sh_lo) / max(u_sh_hi - u_sh_lo, 1e-5), 0.0, 1.0);
  if (u_sh_gamma != 1.0) v = pow(v, u_sh_gamma);
  if (u_sh_steps > 1) { float n = float(u_sh_steps); v = min(floor(v * n), n - 1.0) / (n - 1.0); }
  return u_sh_invert ? 1.0 - v : v;
}

// Roughness / Specular / Metalness (LEVEL_MODES order): replace, multiply, add, min, max — x over o.
float levelBlend(int mode, float o, float x) { return mode == 0 ? x : mode == 1 ? o * x : mode == 2 ? o + x : mode == 3 ? min(o, x) : max(o, x); }

// shapeV: inside the layer's shape (Source › Shape), 1 for layers without one.
float srcValue(int src, float value, float rnd, float shapeV) { return src == 1 ? 1.0 : src == 2 ? rnd : src == 3 ? shapeV : value; }
// The level outputs' source, with Parts (4: the generator's own level there, gGenLevel; LayerDef.parts). gGenFillLevels:
// the generator's value is only shading, so they take the whole shape for it.
float srcLevel(int src, float value, float rnd, float shapeV, float own) {
  if (gGenFillLevels) value = shapeValue(shapeV);
  return src == 4 ? (own >= 0.0 ? own : value) : srcValue(src, value, rnd, shapeV);
}

// A mask texel (distance, feature random, feature flag) after this layer's write: c is its own distance s combined with
// the mask's by op; the feature comes from whichever side c follows (the earlier contents where this layer cuts).
// fid < 0: no features here.
vec4 maskTexel(int op, float c, float s, float fid, vec4 prev) {
  bool fresh = op <= 1 || (op != 3 && op != 6 && abs(c - s) <= abs(c - prev.x));
  return fresh ? vec4(c, max(fid, 0.0), fid >= 0.0 ? 1.0 : 0.0, 0.0) : vec4(c, prev.yzw);
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(tAlbedo, ip, 0);
  vec4 S = texelFetch(tSurface, ip, 0);
  vec4 E = texelFetch(tEmissive, ip, 0);
  // The mask before this layer: the one it writes, or the Shape mask. Pixels it doesn't write keep it.
  vec4 maskPrev = texelFetch(tMaskIn, ip, 0);
  vec4 maskOut = maskPrev;
  float prevDist = maskPrev.x;
  gPhase = u_phase;

  vec2 pp = gl_FragCoord.xy - vec2(u_ofs_x, -u_ofs_y);
  if (u_dw_amount > 0.0) {
    // Domain warp of the whole pattern: neighbouring features move together, so gaps keep their width.
    vec2 wc = cellsFor(u_dw_scale, 1.0);
    pp += warpOffset(gl_FragCoord.xy / uRes * wc, periodOf(wc), uSeed + 409.0) * 2.0 * u_dw_amount;
  }
  GenOut g = gen(pp);
  float value = g.value;
  float cov = g.mask;
  float shapeV = 1.0;
${
	sdf === true
		? /* glsl */ `
  // Writing its shape (Mask › Write to), the layer combines it with the mask by the Mode (index + 1 = sdfCombine op) and
  // draws the combined shape. The combined distance and its screen-space gradient (Bevel aspect) are taken before
  // branching: derivatives need uniform control flow.
  dilateShape(g, cov);
  ${SHAPE_COMBINE}
  vec2 dGrad = vec2(dFdx(d), dFdy(d));
  if (g.sdf > NO_SDF) {
    ${SHAPE_MASK_WRITE}
    float dc = coverage(d, u_aa);
    shapeV = dc;
    // The bevel: from the generator's own bevel distance (GenOut.bdist, as bevelPlain) while the drawn shape is its own
    // (not combined with the mask), else from the combined distance with the aspect taken from its direction (bevelAt)
    // — one profile, its argument picked.
    float bev = bevelProfile(g.bdist > NO_SDF && op <= 1 ? max(-g.bdist, 0.0) / u_bevel : max(-d, 0.0) / bevelWidth(dGrad));
    if (g.own == 1) {
      // genOutOwn: the generator painted its own value and coverage; the shape only goes to the mask.
    } else if (g.own == 2) {
      // genOutShaded: the generator's pattern × the bevel of the combined shape (so another mode — Intersection with a
      // chipped Shape mask — bevels round it too); the coverage stays the generator's.
      float e = bev * dc;
      value *= e;
      gGenAlt.x *= e;
      if (g.hval >= 0.0) g.hval *= e;
    } else {
      cov *= dc;
      // The coverage now carries the shape's anti-aliasing, so Source › Shape is 1 wherever the layer paints — taking
      // the coverage twice put the ramp's middle (often its darkest) on every edge pixel, a dark 1 px outline.
      shapeV = 1.0;
      // Flat (or zero-width) bevels output 1 and let coverage do the anti-aliasing, so edges ramp
      // symmetrically across the boundary; profiled bevels rise from 0 at the edge.
      value = bev;
      gGenAlt.y = 0.0;
    }
    cov *= softEdge(d);
  }
`
		: ''
}${
	sdf === 'mask'
		? /* glsl */ `
  // The Edge card on the generator's own shape: its value (and Height value) × the bevel profile of its distance — that
  // of the shape it writes, or GenOut.bdist (plain px) when its bevel follows more than it writes (Scratches: the faint
  // ones too) — and its own signed height inside the shape (a lip outside stays). 1 at Bevel 0, so the generator's look
  // stands until a bevel is asked for. It is in every compile of the type (≈0.1 s), not a variant: a variant compiling
  // when the Bevel slider leaves 0 would stall the drag far longer. Its coverage stays its own (Anti-alias is the
  // generator's to apply). The gradient is taken before branching: derivatives need uniform control flow.
  dilateShape(g, cov);
  float bd = g.bdist > NO_SDF ? g.bdist : g.sdf;
  vec2 gGrad = vec2(dFdx(bd), dFdy(bd));
  if (bd > NO_SDF && u_bevel > 0.0) {
    float bev = bevelAt(bd, gGrad);
    value *= bev;
    gGenAlt.x *= bev;
    if (g.hval >= 0.0) g.hval *= bev;
    if (g.height > NO_SDF && bd < 0.0) g.height *= bev;
  }
  if (g.sdf > NO_SDF) {
    // A shape for the mask only: the generator shapes its own value and coverage around it.
    ${SHAPE_COMBINE}
    ${SHAPE_MASK_WRITE}
    shapeV = coverage(d, u_aa);
    cov *= softEdge(g.sdf);
  }
`
		: ''
}
  value = shapeValue(value);
  if (gGenAlt.y > 0.0) gGenAlt.x = shapeValue(gGenAlt.x);
  // A separate value for Height (GenOut.hval), shaped the same way.
  float hval = g.hval < 0.0 ? value : shapeValue(g.hval);
  float cutK = 1.0;
  if (u_sh_cut > 0.0) cutK = u_sh_cut_soft > 0.0 ? smoothstep(u_sh_cut - u_sh_cut_soft, u_sh_cut + u_sh_cut_soft, value) : step(u_sh_cut, value);
  cov *= cutK;

  // Everything else that limits the layer: opacity, Limit to, the height mask.
  float k = u_opacity * limitAt(ip);
  if (u_m_hmode != 0) {
    float s = max(u_m_hsoft, 1e-4);
    float hm = smoothstep(u_m_hlevel - s, u_m_hlevel + s, S.r);
    k *= u_m_hmode == 1 ? hm : 1.0 - hm;
  }
  float m = cov * k;
  // Writing its coverage (layers without a shape): as a distance-like value that reads back as the coverage.
  if (uMaskKind == 2) {
    int cop = u_mk_op + 1;
    float s = 0.5 - (uMaskSoft ? m * clamp(value, 0.0, 1.0) : m);
    maskOut = maskTexel(cop, sdfCombine(cop, prevDist, s, u_mk_smooth), s, g.fid, maskPrev);
  }

  if (u_dif_on) {
    float v = srcValue(u_dif_src, value, g.rnd, shapeV);
    v = clamp(v + (g.rnd - 0.5) * u_dif_jitter, 0.0, 1.0);
    vec3 top = gGenRgb.x >= 0.0 ? gGenRgb : gradientLookup(u_dif_grad_stops, u_dif_grad_count, v);
    if (gGenAlt.y > 0.0 && u_dif_src == 0 && gGenRgb.x < 0.0) {
      float va = clamp(gGenAlt.x + (g.rnd - 0.5) * u_dif_jitter, 0.0, 1.0);
      top = mix(top, gradientLookup(u_dif_grad_stops, u_dif_grad_count, va), gGenAlt.y);
    }
    top = mix(top, vec3(luma(top)), gGenGrey) * gGenShade;
    vec3 base = linearToSrgb(A.rgb);
    vec3 blended = blendMode(u_dif_blend, base, top);
    float w = m * u_dif_opacity;
    if (gGenTransmit > 0.0) {
      // Its transmitted share goes to emission (layTransparent: seen through, not shaded by the surface).
      vec3 a = A.rgb, e = E.rgb;
      layTransparent(a, e, srgbToLinear(blended), gGenTransmit, w);
      A.rgb = a;
      E.rgb = e;
    } else A.rgb = srgbToLinear(mix(base, blended, w));
  }
  if (u_op_on) {
    // Replace and Multiply set the alpha outside the coverage too (to 0 there), as far as Strength, Limit to and the
    // height mask (k) let them.
    if (u_op_mode == 0) A.a = mix(A.a, cov, k);
    else if (u_op_mode == 1) A.a *= mix(1.0, cov, k);
    else if (u_op_mode == 2) A.a = max(A.a, m);
    else A.a *= 1.0 - m;
  }
  if (u_h_on) {
    // A height profile of the generator's own (signed, genOutHeight) stands in for the value and carries its own extent:
    // it applies wherever it is non-zero, limited by the clips and opacity but not by the coverage.
    bool own = u_h_src == 0 && g.height > NO_SDF;
    // Per-feature amplitude from a hash decorrelated from the colour random; Offset shifts the whole output.
    float v = (own ? g.height : srcValue(u_h_src, hval, g.rnd, shapeV)) * u_h_amount * (1.0 - u_h_var * g.feat * featVar(g.rnd)) + u_h_offset;
    float h = S.r;
    S.r = mix(h, heightCombine(u_h_mode, h, v), own ? (g.height != 0.0 ? k : 0.0) : m);
  }
  if (u_r_on) {
    float v = srcLevel(u_r_src, value, g.rnd, shapeV, gGenLevel.x);
    float r = mix(u_r_a, u_r_b, v);
    float o = S.g;
    S.g = clamp(mix(o, levelBlend(u_r_mode, o, r), m * u_r_opacity), 0.0, 1.0);
  }
  if (u_s_on) {
    float v = srcLevel(u_s_src, value, g.rnd, shapeV, gGenLevel.y);
    float sp = mix(u_s_a, u_s_b, v);
    float o = E.a;
    E.a = clamp(mix(o, levelBlend(u_s_mode, o, sp), m * u_s_opacity), 0.0, 1.0);
  }
  if (u_mt_on) {
    float v = srcLevel(u_mt_src, value, g.rnd, shapeV, gGenLevel.z);
    float mt = mix(u_mt_a, u_mt_b, v);
    float o = S.b;
    S.b = clamp(mix(o, levelBlend(u_mt_mode, o, mt), m * u_mt_opacity), 0.0, 1.0);
  }
  if (u_e_on) {
    float v = srcLevel(u_e_src, value, g.rnd, shapeV, gGenLevel.w);
    vec3 e = u_e_color * u_e_intensity * v;
    vec3 ne = u_e_mode == 0 ? E.rgb + e : u_e_mode == 1 ? e : max(E.rgb, e);
    E.rgb = mix(E.rgb, ne, m);
  }

  oAlbedo = A;
  oSurface = S;
  oEmissive = E;
  oMask = maskOut;
}
`;
