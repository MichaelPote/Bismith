// The ParamDef model is the single source of truth for every tweakable setting of a layer or post filter:
// the properties panel renders controls from it, the GPU pipeline uploads it as uniforms (u_<key>),
// and the optimiser reads its ranges to know what it may mutate.

export interface GradientStop {
	pos: number; // 0..1
	color: string; // sRGB hex
	/** Opacity 0..1 (none = 1): honoured by the ramps that paint Diffuse (ParamDef.alpha). */
	alpha?: number;
}

export interface Gradient {
	stops: GradientStop[];
}

export interface CurvePoint {
	x: number; // 0..1
	y: number; // 0..1
}

/** A smooth curve through 2–8 points on [0,1]² (e.g. a bevel profile: height against distance in). Points may rise
 * and fall (rims, dishes); the cubic is shape-preserving, so it never overshoots between them. */
export interface Curve {
	points: CurvePoint[];
}

export type ParamValue = number | boolean | string | Gradient | Curve;

export type ParamType = 'float' | 'int' | 'bool' | 'color' | 'enum' | 'seed' | 'gradient' | 'text' | 'curve';

export interface EnumOption {
	value: string;
	label: string;
	/** What the option does (listed in the field's tooltip). */
	hint?: string;
}

export type ParamValues = Record<string, ParamValue>;

export interface ParamDef {
	key: string;
	label: string;
	type: ParamType;
	default: ParamValue;
	/** Hard limits (values are clamped to these). */
	min?: number;
	max?: number;
	/** Slider range shown in the UI when narrower than the hard limits. */
	softMin?: number;
	softMax?: number;
	/** UI only: the slider runs ± the texture width / height (px) instead of softMin..softMax (still the optimiser's range). */
	sliderSpan?: 'width' | 'height';
	/** UI only: a sub-heading within the card. ParamList keeps a section's params together and heads them with it. */
	section?: string;
	step?: number;
	unit?: string;
	options?: EnumOption[];
	/** Properties-panel group id (see GroupDef). */
	group?: string;
	showIf?: (p: ParamValues) => boolean;
	/**
	 * A count per pixel area (e.g. scratches per 64×64 px): supersampling (k× the pixels per side) divides it by k² so
	 * the texture keeps the same number of features — like unit 'px' values are multiplied by k.
	 */
	perArea?: boolean;
	/** A quantity per pixel (e.g. mask gain per px of curvature): divided by the pixel scale (core/pixelScale.ts). */
	perPx?: boolean;
	/**
	 * With unit 'px': the texture axis the length runs along — it scales with that side of the canvas (core/pixelScale.ts).
	 * A function picks it from the layer's params (orientation); null, or no axis, = both (the side of the area).
	 * sliderSpan params follow their span's axis without it.
	 */
	axis?: 'x' | 'y' | ((p: ParamValues) => 'x' | 'y' | null);
	/**
	 * With unit 'px': the size of one output pixel (Rock's pixel scale), so supersampling scales it but resizing the
	 * canvas doesn't — more pixels are finer pixels, not bigger ones.
	 */
	outputPx?: boolean;
	/** Whether the optimiser may mutate it. Defaults: float/int/color/gradient yes, others no. */
	optimize?: boolean;
	/** A gradient whose stops each have an opacity (the editor shows it): one that paints Diffuse. */
	alpha?: boolean;
	/**
	 * Counts only while the bool param `by` is on; with it off the shaders get `off`, whatever this holds. For a slider
	 * behind a tickbox because it picks a shader variant (the tickbox picks it instead, so dragging never compiles).
	 */
	gate?: { by: string; off: number };
	/** Set false for UI-only params that are not uploaded as uniforms. */
	uniform?: boolean;
	/**
	 * Text params only: upload the text as a pixel bitmap (see core/bitmap.ts) — 'pixels' parses rows of cell
	 * characters, 'font' renders the text in the pixel font. Declares `ivec4 u_<key>[64]` + `ivec2 u_<key>_size`.
	 * 'points' parses polygons ("x,y x,y …", one polygon per line or '|') into `vec4 u_<key>[64]` (x, y, index of
	 * the polygon's next vertex, polygon index) + `ivec2 u_<key>_size` (vertex count, polygon count). 'lines' is the
	 * same for open polylines (two or more points; the last vertex's "next" still wraps — skip that closing segment).
	 * The shape editor draws 'points' shapes closed and 'lines' shapes open.
	 */
	bitmap?: 'pixels' | 'font' | 'points' | 'lines';
	/**
	 * UI only, 'points' / 'lines' bitmaps the shape editor adds to (pipe runs, hand-placed splats): the Line tool's button
	 * is named `adds` and adds a line here instead of creating a Polyline layer, its tooltip ending in `hint` ("a new run
	 * of the selected pipes"). `min`: the fewest points a line keeps (default 2 open, 3 closed); `budget`: the most
	 * vertices (default MAX_PATH_POINTS, a bitmap uniform's).
	 */
	shapeEdit?: {
		adds: string;
		hint: string;
		min?: number;
		budget?: number;
		/** Each point stands alone (hand-placed splats): drawn as dots, no lines between them. */
		dots?: boolean;
	};
	/**
	 * Text params only: an image file (core/images.ts) — the value is its file name ('' = none), the inspector shows a
	 * file picker and a thumbnail, and the layer reads the pixels in its cpuData (getImage).
	 */
	image?: boolean;
	/**
	 * Image params: an environment — HDR files (OpenEXR, Radiance HDR, Ultra HDR JPEG) accepted besides PNG / JPEG /
	 * WebP, and kept as a small Ultra HDR JPEG (core/environment.ts) instead of a PNG fitted to the texture.
	 */
	environment?: boolean;
	/**
	 * UI only, text params: a mask name (FR8.23), drawn as a dropdown of masks with "New mask…" — 'read' a mask layers
	 * above write (Limit to, sources), 'write' the mask the layer writes. `maskChoices` lists them; the inspector fills it
	 * per layer.
	 */
	mask?: 'read' | 'write';
	maskChoices?: string[];
	/** UI only, enums: a row of toggle buttons, one per option (Limit to's And / Or / Except), instead of a dropdown. */
	segmented?: boolean;
	/** UI only: no visible label — the row continues the one above (the masks after the first in Limit to). */
	bare?: boolean;
	hint?: string;
	/** UI only: the label for the current values, when the param means something different per mode (e.g. per style). */
	labelFor?: (p: ParamValues) => string;
	/**
	 * UI only: a note on the current values (e.g. "capped at 0.4 cell by Even strokes"), or undefined for none. The
	 * label is highlighted and the tooltip shows the note above the hint. LayerDef.paramPatch adds one to a shared param.
	 */
	note?: (p: ParamValues) => string | undefined;
	/**
	 * UI only: draw this param in one row with the param `with`, which then isn't drawn on its own. 'pair' puts the two
	 * controls side by side (Source · Mode, Levels low · high); 'ramp' draws a scalar ramp from this value (where the source is 0) to the
	 * partner's (where it is 1). `label` names the row.
	 */
	join?: { with: string; as: 'pair' | 'ramp'; label: string };
}

export interface GroupDef {
	id: string;
	label: string;
	/** A bool param whose checkbox lives in the group's header (e.g. channel outputs). */
	toggleKey?: string;
	collapsed?: boolean;
}

export const MAX_GRADIENT_STOPS = 8;
export const MAX_CURVE_POINTS = 8;

export function isCurve(v: unknown): v is Curve {
	return typeof v === 'object' && v !== null && Array.isArray((v as Curve).points);
}

export function cloneValue<T extends ParamValue>(v: T): T {
	if (isCurve(v)) return { points: v.points.map((p) => ({ ...p })) } as T;
	if (typeof v === 'object' && v !== null) {
		return { stops: (v as Gradient).stops.map((s) => ({ ...s })) } as T;
	}
	return v;
}

export function defaultParams(defs: ParamDef[]): ParamValues {
	const out: ParamValues = {};
	for (const d of defs) out[d.key] = cloneValue(d.default);
	return out;
}

export function isOptimizable(def: ParamDef): boolean {
	if (def.optimize !== undefined) return def.optimize;
	return def.type === 'float' || def.type === 'int' || def.type === 'color' || def.type === 'gradient';
}

export function enumIndex(def: ParamDef, value: ParamValue): number {
	const i = def.options?.findIndex((o) => o.value === value) ?? -1;
	return i < 0 ? 0 : i;
}

/** Coerce a (possibly stale or hand-written) value to something valid for the def. */
export function sanitizeValue(def: ParamDef, v: ParamValue | undefined): ParamValue {
	if (v === undefined || v === null) return cloneValue(def.default);
	switch (def.type) {
		case 'float':
		case 'int':
		case 'seed': {
			let n = typeof v === 'number' ? v : Number(v);
			if (!Number.isFinite(n)) return cloneValue(def.default);
			if (def.min !== undefined) n = Math.max(def.min, n);
			if (def.max !== undefined) n = Math.min(def.max, n);
			if (def.type !== 'float') n = Math.round(n);
			return n;
		}
		case 'bool':
			return Boolean(v);
		case 'color':
			return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : cloneValue(def.default);
		case 'enum':
			return def.options?.some((o) => o.value === v) ? v : cloneValue(def.default);
		case 'text':
			return typeof v === 'string' ? v : String(v);
		case 'curve': {
			if (!isCurve(v)) return cloneValue(def.default);
			const pts = v.points
				.map((p) => ({ x: Math.min(1, Math.max(0, Number(p.x) || 0)), y: Math.min(1, Math.max(0, Number(p.y) || 0)) }))
				.sort((a, b) => a.x - b.x)
				.filter((p, i, a) => i === 0 || p.x > a[i - 1].x + 1e-4)
				.slice(0, MAX_CURVE_POINTS);
			return pts.length >= 2 ? { points: pts } : cloneValue(def.default);
		}
		case 'gradient': {
			const g = v as Gradient;
			if (!g || !Array.isArray(g.stops) || g.stops.length === 0) return cloneValue(def.default);
			const stops = g.stops
				.slice(0, MAX_GRADIENT_STOPS)
				.map((s) => {
					const a = Number(s.alpha);
					return {
						pos: Math.min(1, Math.max(0, Number(s.pos) || 0)),
						color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : '#808080',
						...(Number.isFinite(a) && a < 1 ? { alpha: Math.max(0, a) } : {})
					};
				})
				.sort((a, b) => a.pos - b.pos);
			return { stops };
		}
	}
}

export function sanitizeParams(defs: ParamDef[], values: ParamValues | undefined): ParamValues {
	const out: ParamValues = {};
	for (const d of defs) out[d.key] = sanitizeValue(d, values?.[d.key]);
	return out;
}

export function gradient(...colors: string[]): Gradient {
	const n = colors.length;
	return { stops: colors.map((color, i) => ({ pos: n === 1 ? 0 : i / (n - 1), color })) };
}

/** Rounds to a tenth (linked and fresh param values). */
export const round1 = (v: number) => Math.round(v * 10) / 10;

/** Rounds a px length to a half pixel, at least `lo` (fresh param values sized to the texture). */
export const halfPx = (v: number, lo = 0.5) => Math.max(lo, Math.round(v * 2) / 2);

// Small helpers to keep ParamDef tables terse.
type Extra = Partial<Omit<ParamDef, 'key' | 'label' | 'type' | 'default'>>;

/**
 * ParamDef axis for a px length tied to an orientation param: `along` maps each of `key`'s options to the texture axis
 * it runs along (options left out, e.g. diagonals, scale with both); `across` gives the other axis.
 */
export function orientAxis(key: string, along: Record<string, 'x' | 'y'>, across = false) {
	return (p: ParamValues): 'x' | 'y' | null => {
		const a = along[String(p[key])] ?? null;
		return a && across ? (a === 'x' ? 'y' : 'x') : a;
	};
}

export const P = {
	float: (key: string, label: string, def: number, min: number, max: number, extra: Extra = {}): ParamDef => ({
		key,
		label,
		type: 'float',
		default: def,
		min,
		max,
		...extra
	}),
	int: (key: string, label: string, def: number, min: number, max: number, extra: Extra = {}): ParamDef => ({
		key,
		label,
		type: 'int',
		default: def,
		min,
		max,
		step: 1,
		...extra
	}),
	bool: (key: string, label: string, def: boolean, extra: Extra = {}): ParamDef => ({
		key,
		label,
		type: 'bool',
		default: def,
		...extra
	}),
	color: (key: string, label: string, def: string, extra: Extra = {}): ParamDef => ({
		key,
		label,
		type: 'color',
		default: def,
		...extra
	}),
	enum: (
		key: string,
		label: string,
		def: string,
		options: ([string, string] | [string, string, string])[],
		extra: Extra = {}
	): ParamDef => ({
		key,
		label,
		type: 'enum',
		default: def,
		options: options.map(([value, l, hint]) => ({ value, label: l, ...(hint ? { hint } : {}) })),
		...extra
	}),
	seed: (key = 'seed', label = 'Seed', def = 1, extra: Extra = {}): ParamDef => ({
		key,
		label,
		type: 'seed',
		default: def,
		min: 0,
		max: 99999,
		step: 1,
		...extra
	}),
	gradient: (key: string, label: string, def: Gradient, extra: Extra = {}): ParamDef => ({
		key,
		label,
		type: 'gradient',
		default: def,
		...extra
	}),
	/** Free text (not uploaded as a uniform), e.g. a custom palette as a list of hex colours. */
	text: (key: string, label: string, def: string, extra: Extra = {}): ParamDef => ({
		key,
		label,
		type: 'text',
		default: def,
		uniform: false,
		optimize: false,
		...extra
	}),
	/** A shape-preserving curve on [0,1]² (editable points; uploaded as `vec4 u_<key>_pts[8]` + count, see curveTangents). */
	curve: (key: string, label: string, def: Curve, extra: Extra = {}): ParamDef => ({
		key,
		label,
		type: 'curve',
		default: def,
		optimize: false,
		...extra
	}),
	/** An image file (core/images.ts): its file name, picked in the inspector. */
	image: (key: string, label: string, extra: Extra = {}): ParamDef => ({
		key,
		label,
		type: 'text',
		default: '',
		image: true,
		uniform: false,
		optimize: false,
		...extra
	}),
	/** A pixel bitmap typed as text (uploaded as a bitmap uniform). */
	bitmap: (
		key: string,
		label: string,
		def: string,
		mode: 'pixels' | 'font' | 'points' | 'lines',
		extra: Extra = {}
	): ParamDef => ({
		key,
		label,
		type: 'text',
		default: def,
		bitmap: mode,
		optimize: false,
		...extra
	})
};

/**
 * Fritsch–Carlson tangents for a shape-preserving cubic Hermite curve through sorted points: it never overshoots
 * between points (a rising stretch never dips; a peak or valley sits exactly on its point), while the points
 * themselves may rise and fall — rims and dishes. Returns one slope per point.
 */
export function curveTangents(pts: CurvePoint[]): number[] {
	const n = pts.length;
	if (n < 2) return pts.map(() => 0);
	const d = pts.slice(0, -1).map((p, i) => (pts[i + 1].y - p.y) / Math.max(pts[i + 1].x - p.x, 1e-6));
	const m = pts.map((_, i) =>
		i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
	);
	for (let i = 0; i < n - 1; i++) {
		if (d[i] === 0) {
			m[i] = 0;
			m[i + 1] = 0;
			continue;
		}
		const a = m[i] / d[i];
		const b = m[i + 1] / d[i];
		const h = a * a + b * b;
		if (h > 9) {
			const t = 3 / Math.sqrt(h);
			m[i] = t * a * d[i];
			m[i + 1] = t * b * d[i];
		}
	}
	return m;
}

/** Evaluate the curve at x (same maths as the GLSL `curve_<key>`). */
export function evalCurve(c: Curve, x: number): number {
	const p = c.points;
	const m = curveTangents(p);
	if (x <= p[0].x) return p[0].y;
	for (let i = 0; i < p.length - 1; i++) {
		if (x <= p[i + 1].x) {
			const h = p[i + 1].x - p[i].x;
			const t = (x - p[i].x) / h;
			const t2 = t * t;
			const t3 = t2 * t;
			return (
				(2 * t3 - 3 * t2 + 1) * p[i].y +
				(t3 - 2 * t2 + t) * h * m[i] +
				(-2 * t3 + 3 * t2) * p[i + 1].y +
				(t3 - t2) * h * m[i + 1]
			);
		}
	}
	return p[p.length - 1].y;
}
