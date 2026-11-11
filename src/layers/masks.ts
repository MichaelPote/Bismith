// Masks (FR8.23): named, each per pixel a signed distance (px, < 0 inside), the random of the feature there and whether
// there is one. A layer writes one (Mask › Write to) — shape layers their shape, others their coverage — and is
// limited by an expression of them (Limit to). Masks follow the stack: a layer sees what the layers above it wrote.
//
// Every write makes a new version of its mask. planMasks works out, for one evaluation, which versions a later layer
// still reads and gives each a slot (a texture) only for as long as it does: as many slots as versions are alive at
// once, none for a version nobody reads. The pipeline (render/materialPipeline.ts) copies each written version that has
// a slot into it, and binds the versions each layer reads.

import {
	SHAPE_MASK,
	hiddenByGroup,
	type Layer,
	type LimitExpr,
	type LimitOp,
	type LayerGroup,
	type Project
} from '@/core/project';
import type { ParamValues } from '@/core/params';
import { MAX_LIMIT_TERMS, MAX_WRITE_ROWS, SRC_KEYS, rowKey } from './commonParams';
import { getLayerDef, layerParamDefs, maskSourcesOf } from './registry';
import type { LayerDef } from './types';

export { SHAPE_MASK };

const name = (v: unknown) => String(v ?? '').trim();

/** The mask a layer's params name in Write to, or null (written or not: see maskWriteKind). */
export function maskTarget(params: ParamValues): string | null {
	return name(params.mk_target) || null;
}

/**
 * What a generator writes into its target with these params: its shape (a distance), its coverage, or nothing. A shape
 * layer in a mode without a shape (Stone blocks' joints) writes its coverage — but not into the Shape mask, the default
 * target of shape layers, which it leaves alone.
 */
export function maskWriteKind(def: LayerDef | undefined, params: ParamValues): 'shape' | 'coverage' | false {
	const target = maskTarget(params);
	if (!def || def.kind !== 'generator' || !target) return false;
	if (def.maskWrite) return def.maskWrite(params);
	if (!def.sdf) return 'coverage';
	if (!def.sdfShowIf || def.sdfShowIf(params)) return 'shape';
	return target === SHAPE_MASK ? false : 'coverage';
}

/** One mask a layer writes: where, what, and the params its pass runs with. */
export interface MaskWrite {
	target: string;
	kind: 'shape' | 'coverage';
	op: string;
	params: ParamValues;
	/** A pass of its own (a row after the first, or a source the layer's own pass can't give), not in the layer's. */
	extra: boolean;
	/** A coverage that takes the output's value too (an output source's gradient). */
	soft?: boolean;
}

/**
 * Every mask a layer writes, in the order its passes run (FR8.23): Write to's rows, each its Source (masks sources,
 * registry maskSourcesOf) into its Target by its Mode, Smoothness and Feather — by the same rule as maskWriteKind, so
 * never a coverage into the Shape mask of a shape layer; empty rows write nothing. Row 1 rides in the layer's own pass
 * when its source is the layer or changes only what goes to the mask (`main`); the others are passes of their own, run
 * first.
 */
export function layerWrites(def: LayerDef | undefined, params: ParamValues): MaskWrite[] {
	if (!def || def.kind !== 'generator') return [];
	const srcs = maskSourcesOf(def.type);
	const extra: MaskWrite[] = [];
	let main: MaskWrite | null = null;
	for (let n = 1; n <= MAX_WRITE_ROWS; n++) {
		// Each source's own row may be empty; the rows past them stop at the first empty one (as Write to shows them).
		const target = name(params[rowKey('mk_target', n)]);
		if (!target && n > srcs.length) break;
		if (!target) continue;
		const src = srcs.find((s) => s.value === params[rowKey('mk_src', n)]) ?? srcs[0];
		const inMain = n === 1 && (!src || src.value === 'layer' || src.main === true);
		const ps: ParamValues = {
			...params,
			...(src?.params ?? {}),
			mk_target: target,
			mk_op: params[rowKey('mk_op', n)] ?? 'replace',
			mk_smooth: params[rowKey('mk_smooth', n)] ?? 4,
			mk_feather: params[rowKey('mk_feather', n)] ?? 0,
			...(inMain ? {} : { sh_cut: 0 })
		};
		// An output source writes its coverage × value (a gradient output — an underside, a falloff — fades along it): not
		// into Shape on a shape layer, whose Shape mask is a distance. Other sources write by the type's rule.
		const soft = src?.soft === true;
		const kind = soft ? (def.sdf && target === SHAPE_MASK ? false : 'coverage') : maskWriteKind(def, ps);
		if (!kind) continue;
		const w: MaskWrite = { target, kind, op: String(ps.mk_op), params: ps, extra: !inMain, soft };
		if (inMain) main = w;
		else extra.push(w);
	}
	return main ? [...extra, main] : extra;
}

/** A stored limit operator made valid: 'or', 'minus', else 'and'. */
const toLimitOp = (v: unknown): LimitOp => (v === 'or' || v === 'minus' ? v : 'and');

/** A layer's own Limit to expression (lim_1 … lim_4, Invert), or null for none. */
export function layerLimit(params: ParamValues): LimitExpr | null {
	const terms: LimitExpr['terms'] = [];
	for (let n = 1; n <= MAX_LIMIT_TERMS; n++) {
		const mask = name(params[`lim_${n}`]);
		if (!mask) break;
		terms.push({ mask, op: n === 1 ? 'and' : toLimitOp(params[`lim_op${n}`]) });
	}
	return terms.length ? { terms, outside: params.lim_out === true } : null;
}

/** Params for a Limit to expression (the inverse of layerLimit). */
export function limitParams(e: LimitExpr | null): ParamValues {
	const out: ParamValues = { lim_out: e?.outside ?? false };
	for (let n = 1; n <= MAX_LIMIT_TERMS; n++) {
		const t = e?.terms[n - 1];
		out[`lim_${n}`] = t?.mask ?? '';
		if (n > 1) out[`lim_op${n}`] = t?.op ?? 'and';
	}
	return out;
}

/**
 * A limit expression from short arguments: limitTo('Shape') · limitTo('Shape', { outside: true }) · ['Shape', '−', 'Opening'].
 * Operators may be spelled 'or' / 'and' / 'minus' too, so a mask literally named one of those can't be listed.
 */
export function limitTo(
	spec: string | (string | LimitOp | '∪' | '∩' | '−')[],
	opts: { outside?: boolean } = {}
): ParamValues {
	const list = typeof spec === 'string' ? [spec] : spec;
	const terms: LimitExpr['terms'] = [];
	let op: LimitOp = 'and';
	for (const s of list) {
		if (s === '∪' || s === 'or') op = 'or';
		else if (s === '∩' || s === 'and') op = 'and';
		else if (s === '−' || s === 'minus') op = 'minus';
		else {
			terms.push({ mask: s, op: terms.length ? op : 'and' });
			op = 'and';
		}
	}
	return limitParams({ terms, outside: opts.outside ?? false });
}

/**
 * Params of a Mask area layer that draws a mask's own shape (Features › Inside; type 'surfacemask'): one pattern
 * layer writes the layout, and layers like this give it more relief or colour — each feature with its own random —
 * without copying it. Writes no mask; flat Edge unless given one; `layout` (the pattern layer's params) passes on its
 * Anti-alias, so hard pixel edges stay hard.
 */
export function fromMask(mask: string = SHAPE_MASK, layout?: ParamValues): ParamValues {
	return {
		select: 'features',
		area: 'inside',
		src_mask: mask,
		mk_target: '',
		bevel: 0,
		profile: 'flat',
		...(layout && 'aa' in layout ? { aa: layout.aa } : {})
	};
}

/** The expression as a short label: "Shape − Opening", "outside Moss ∪ Wet". */
export function limitLabel(e: LimitExpr): string {
	const sym: Record<LimitOp, string> = { and: '∩', or: '∪', minus: '−' };
	const body = e.terms.map((t, i) => (i === 0 ? t.mask : `${sym[t.op]} ${t.mask}`)).join(' ');
	return e.outside ? `outside ${body}` : body;
}

/** Each layer's group (members only). */
function groupsOf(p: Pick<Project, 'groups'>): Map<string, LayerGroup> {
	const m = new Map<string, LayerGroup>();
	for (const g of p.groups ?? []) for (const id of g.members) m.set(id, g);
	return m;
}

/** Layers that run, in order: enabled and not hidden by their group. */
function running(p: Project): Layer[] {
	const hidden = hiddenByGroup(p);
	return p.layers.filter((l) => l.enabled && !hidden.has(l.id) && getLayerDef(l.type));
}

// ------------------------------------------------------------------------------------------------ labels and pickers

/** One writer of a mask and how it combined with what was there (its Mode). */
export interface MaskWriter {
	name: string;
	op: string;
}

const OP_SYMBOL: Record<string, string> = {
	union: '+',
	subtract: '−',
	intersect: '∩',
	'smooth-union': '+',
	'smooth-subtract': '−',
	'smooth-intersect': '∩'
};

/**
 * The writers `mask` holds when `layerId` runs, in evaluation order: back to the last one in Normal mode (which
 * replaced everything before it). Empty: nothing has written it yet.
 */
export function maskChain(p: Project, layerId: string, mask: string): MaskWriter[] {
	return writesHeld(p, layerId, mask).map((w) => ({ name: w.layer.name, op: w.op }));
}

/** The layers whose writes `mask` holds when `layerId` runs, in stack order (see maskChain). */
export function maskWriters(p: Project, layerId: string, mask: string): Layer[] {
	return [...new Set(writesHeld(p, layerId, mask).map((w) => w.layer))];
}

function writesHeld(p: Project, layerId: string, mask: string): { layer: Layer; op: string }[] {
	const chain: { layer: Layer; op: string }[] = [];
	const at = p.layers.findIndex((l) => l.id === layerId);
	for (const l of running(p)
		.filter((l) => p.layers.indexOf(l) < at)
		.reverse()) {
		for (const w of layerWrites(getLayerDef(l.type), l.params).reverse()) {
			if (w.target !== mask) continue;
			chain.unshift({ layer: l, op: w.op });
			if (w.op === 'replace') return chain;
		}
	}
	return chain;
}

/** A line of the outliner's mask lane: `reader` is limited to `mask`, which `writer` wrote (layer ids). */
export interface MaskLink {
	reader: string;
	writer: string;
	mask: string;
}

/**
 * Who limits to whom (the outliner's mask lane): for every layer with a Limit to, and every material with a limit (as
 * its first member), each mask it names back to the layers that wrote what it reads there.
 */
export function maskLinks(p: Project): MaskLink[] {
	const links: MaskLink[] = [];
	// `at`: the layer whose place in the stack decides what the mask holds.
	const add = (reader: string, at: string, e: LimitExpr | null | undefined) => {
		for (const t of e?.terms ?? [])
			for (const w of maskWriters(p, at, t.mask)) links.push({ reader, writer: w.id, mask: t.mask });
	};
	for (const l of p.layers) add(l.id, l.id, layerLimit(l.params));
	for (const g of p.groups ?? []) {
		const first = p.layers.find((l) => g.members.includes(l.id));
		if (first) add(`group:${g.id}`, first.id, g.limit);
	}
	return links;
}

/**
 * The masks read where nothing has written them yet, so they are empty there (the outliner's warning): per layer, its
 * Limit to and its source mask (Bevel, Etch, Mask area…); per group with a limit (`group:<id>`, read at its first
 * member), the group's. Disabled layers write nothing.
 */
export function unwrittenMasks(p: Project): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const check = (key: string, at: string, names: string[]) => {
		const empty = [...new Set(names)].filter((m) => !writesHeld(p, at, m).length);
		if (empty.length) out.set(key, empty);
	};
	for (const l of p.layers) {
		const def = getLayerDef(l.type);
		if (!def) continue;
		const names = (layerLimit(l.params)?.terms ?? []).map((t) => t.mask);
		const src = def.maskSource?.(l.params);
		if (src) names.push(src);
		check(l.id, l.id, names);
	}
	for (const g of p.groups ?? []) {
		const first = p.layers.find((l) => g.members.includes(l.id));
		if (first && g.limit?.terms.length)
			check(
				`group:${g.id}`,
				first.id,
				g.limit.terms.map((t) => t.mask)
			);
	}
	return out;
}

/** The chain as a short expression, "Panel − Vent" (the last three writers at most). */
export function maskChainLabel(chain: MaskWriter[]): string {
	const terms = chain.map((w, k) => (k === 0 ? w.name : `${OP_SYMBOL[w.op] ?? '+'} ${w.name}`));
	return terms.length > 3 ? `… ${terms.slice(-3).join(' ')}` : terms.join(' ');
}

/** Names of the masks written above `layerId` (or anywhere, without one), Shape first, then in order of first write. */
export function masksAbove(p: Project, layerId?: string): string[] {
	const at = layerId ? p.layers.findIndex((l) => l.id === layerId) : p.layers.length;
	const names: string[] = [];
	for (const l of running(p)) {
		if (p.layers.indexOf(l) >= at) break;
		for (const w of layerWrites(getLayerDef(l.type), l.params)) if (!names.includes(w.target)) names.push(w.target);
	}
	return names.sort((a, b) => (a === SHAPE_MASK ? -1 : b === SHAPE_MASK ? 1 : 0));
}

// ------------------------------------------------------------------------------------------------ colours

/**
 * The category hues (tokens.css `--cat-<hue>`) masks are drawn in wherever the UI shows one: their fields, Write to's
 * slots, the Outliner's lane, the Masks view. Shape is always gold; every other mask is given one when it is first named
 * (assignMaskHues) — the one the masks there are use least — and keeps it (Project.maskHues).
 */
export const SHAPE_HUE = 'gold';
export const MASK_HUES = ['teal', 'rose', 'moss', 'violet', 'sky', 'crimson', 'indigo', 'slate', 'stone'];

/** Every mask the project names: written, read (Limit to, edges, Mask area) or in a group's limit. */
export function maskNames(p: Project): string[] {
	const names = new Set<string>();
	for (const l of p.layers)
		for (const d of layerParamDefs(l.type)) {
			const n = d.mask ? name(l.params[d.key]) : '';
			if (n) names.add(n);
		}
	for (const g of p.groups ?? []) for (const t of g.limit?.terms ?? []) names.add(t.mask);
	return [...names];
}

/** Gives every mask without a hue one, the least used (in MASK_HUES' order on a tie). True if any was given. */
export function assignMaskHues(p: Project): boolean {
	const names = maskNames(p).filter((n) => n !== SHAPE_MASK);
	const has = (n: string) => MASK_HUES.includes(p.maskHues?.[n] ?? '');
	const used = new Map(MASK_HUES.map((h) => [h, 0]));
	for (const n of names) if (has(n)) used.set(p.maskHues![n], used.get(p.maskHues![n])! + 1);
	let given = false;
	for (const n of names) {
		if (has(n)) continue;
		const h = MASK_HUES.reduce((a, b) => (used.get(b)! < used.get(a)! ? b : a));
		(p.maskHues ??= {})[n] = h;
		used.set(h, used.get(h)! + 1);
		given = true;
	}
	return given;
}

/** A mask's hue: Shape's, the one it was given, or — not given one yet — one picked by its name. */
export function maskHue(p: Project, mask: string): string {
	if (mask === SHAPE_MASK) return SHAPE_HUE;
	const h = p.maskHues?.[mask];
	if (h && MASK_HUES.includes(h)) return h;
	let s = 0;
	for (const c of mask) s = (s * 31 + c.charCodeAt(0)) >>> 0;
	return MASK_HUES[s % MASK_HUES.length];
}

// ------------------------------------------------------------------------------------------------ the evaluation plan

/** A version of a mask a layer reads. slot −1: none — the mask is empty there (nothing wrote it yet). */
export interface MaskRef {
	mask: string;
	version: number;
	slot: number;
	/** Its distance is a true distance (only shapes wrote it, without Feather): edges read it directly. */
	exact: boolean;
	/**
	 * It holds a coverage and nothing more: written by layers without a shape (noise with a cutoff, Stone blocks'
	 * joints), not an output's value (a soft write) — so a layer whose value is that coverage has little pattern to show.
	 */
	plain: boolean;
}

/**
 * One term of a layer's flattened limit: `acc op (neg ? −d : d)` in distance terms (or = min, and = max, minus =
 * max(acc, −d)); group 0 is the layer's own expression, group 1 its material's, intersected at the end.
 */
export interface LimitTerm {
	ref: MaskRef;
	op: LimitOp | 'first';
	neg: boolean;
	group: 0 | 1;
}

export interface LayerMasks {
	/** What the layer reads as the mask before it (`maskIn()`): its target's last version, or the Shape mask's. */
	input: MaskRef | null;
	/** The version it writes; slot −1 when no later layer reads it (no copy). */
	write: (MaskRef & { kind: 'shape' | 'coverage' }) | null;
	/** The params its own pass runs with: its first row's source over its own (a part for the mask), or its own. */
	params: ParamValues;
	/** Its other writes (Write to's rows), each a pass of its own before the layer's: input, version, params. */
	extra: { input: MaskRef; write: MaskRef & { kind: 'shape' | 'coverage' }; params: ParamValues; soft: boolean }[];
	/** Its limit, flattened (Invert folded in); null = none. */
	limit: LimitTerm[] | null;
	/** Its source mask (edge filters, Mask area), or null. */
	source: MaskRef | null;
	/** Its value is only a plain coverage here (LayerDef.coverageOnly): Pattern sources show little but its edge. */
	coverageOnly: boolean;
}

export interface MaskPlan {
	layers: Map<string, LayerMasks>;
	/** Slot textures needed. */
	slots: number;
	/** Each mask's last version (kept to the end for the Masks view), by name. */
	final: Map<string, MaskRef>;
}

/**
 * Terms of a left-to-right expression with Invert (`outside`) folded in by De Morgan, so the combine never inverts a partial result:
 * ¬(X ∪ C) = ¬X ∩ ¬C, ¬(X ∩ C) = ¬X ∪ ¬C, ¬(X − C) = ¬X ∪ C.
 */
function flatten(e: LimitExpr, group: 0 | 1): { mask: string; op: LimitOp | 'first'; neg: boolean; group: 0 | 1 }[] {
	return e.terms.map((t, i) => {
		if (i === 0) return { mask: t.mask, op: 'first' as const, neg: e.outside, group };
		if (!e.outside) return { mask: t.mask, op: t.op, neg: false, group };
		if (t.op === 'or') return { mask: t.mask, op: 'and' as const, neg: true, group };
		if (t.op === 'and') return { mask: t.mask, op: 'or' as const, neg: true, group };
		return { mask: t.mask, op: 'or' as const, neg: false, group };
	});
}

/** Plan the masks of one evaluation of the layers up to index `upTo` (FR8.23). */
export function planMasks(p: Project, upTo = Infinity): MaskPlan {
	const groups = groupsOf(p);
	const list = running(p).filter((l) => p.layers.indexOf(l) <= upTo);
	// Current version of each mask, and whether it's exact or a plain coverage.
	const current = new Map<string, { version: number; exact: boolean; plain: boolean }>();
	const refOf = (mask: string): MaskRef => {
		const c = current.get(mask);
		return { mask, version: c?.version ?? 0, slot: -1, exact: c ? c.exact : true, plain: c ? c.plain : false };
	};
	// Per version (`mask#v`): the index of its last reader.
	const lastRead = new Map<string, number>();
	const key = (r: { mask: string; version: number }) => `${r.mask}#${r.version}`;
	const read = (r: MaskRef, i: number) => {
		if (r.version > 0) lastRead.set(key(r), Math.max(lastRead.get(key(r)) ?? -1, i));
	};

	const plans: { layer: Layer; plan: LayerMasks }[] = [];
	list.forEach((layer, i) => {
		const def = getLayerDef(layer.type)!;
		const params = layer.params;
		const writes = layerWrites(def, params);
		const main = writes.find((w) => !w.extra) ?? null;

		// Limits and sources first: every pass of the layer reads them as they were before it.
		const own = layerLimit(params);
		const mat = groups.get(layer.id)?.limit;
		const flat = [...(own ? flatten(own, 0) : []), ...(mat?.terms.length ? flatten(mat, own ? 1 : 0) : [])];
		const limit = flat.length ? flat.map((t) => ({ ref: refOf(t.mask), op: t.op, neg: t.neg, group: t.group })) : null;
		for (const t of limit ?? []) read(t.ref, i);

		const srcName = def.maskSource?.(params) ?? null;
		const source = srcName ? refOf(srcName) : null;
		if (source) read(source, i);
		const coverageOnly = def.coverageOnly?.(params, source) ?? false;

		const commit = (w: MaskWrite): NonNullable<LayerMasks['write']> => {
			const prev = current.get(w.target);
			const feather = Number(w.params.mk_feather ?? 0) > 0;
			const exact = w.kind === 'shape' && !feather && (w.op === 'replace' || !prev || prev.exact);
			// A layer whose value is a plain coverage passes it on, whatever kind it writes.
			const plain = ((w.kind === 'coverage' && !w.soft) || coverageOnly) && (w.op === 'replace' || !prev || prev.plain);
			const version = (prev?.version ?? 0) + 1;
			current.set(w.target, { version, exact, plain });
			return { mask: w.target, version, slot: -1, exact, plain, kind: w.kind };
		};
		const extra = writes
			.filter((w) => w.extra)
			.map((w) => {
				const input = refOf(w.target);
				read(input, i);
				return { input, write: commit(w), params: w.params, soft: w.soft === true };
			});

		// A writer always reads its target (pixels it leaves keep it); other layers the Shape mask, if they read one at all.
		const input = main ? refOf(main.target) : def.readsMask ? refOf(SHAPE_MASK) : null;
		if (input) read(input, i);
		const write = main ? commit(main) : null;
		plans.push({ layer, plan: { input, write, params: main?.params ?? params, extra, limit, source, coverageOnly } });
	});

	// Every mask's last version stays to the end (the Masks view shows it).
	const final = new Map<string, MaskRef>();
	for (const [mask, c] of current) {
		final.set(mask, { mask, version: c.version, slot: -1, exact: c.exact, plain: c.plain });
		lastRead.set(`${mask}#${c.version}`, Infinity);
	}

	// Slots: a version gets one when written, if read later, and frees it after its last reader. A layer's own write may
	// take the slot of a version it was the last to read: the pipeline copies the write in after the layer has run.
	const slotOf = new Map<string, number>();
	const free: number[] = [];
	let slots = 0;
	const ends = new Map<number, string[]>();
	for (const [k, at] of lastRead) if (Number.isFinite(at)) ends.set(at, [...(ends.get(at) ?? []), k]);
	const take = (w: MaskRef | null) => {
		if (!w || !lastRead.has(key(w))) return;
		free.sort((a, b) => b - a);
		const s = free.length ? free.pop()! : slots++;
		slotOf.set(key(w), s);
		w.slot = s;
	};
	plans.forEach(({ plan }, i) => {
		// Extra writes are copied in before the layer's own pass, which still reads what it reads: not into those slots.
		for (const e of plan.extra) take(e.write);
		for (const k of ends.get(i) ?? []) {
			const s = slotOf.get(k);
			if (s !== undefined) free.push(s);
		}
		take(plan.write);
	});
	const fill = (r: MaskRef | null) => {
		if (r && r.version > 0) r.slot = slotOf.get(key(r)) ?? -1;
	};
	for (const { plan } of plans) {
		for (const e of plan.extra) fill(e.input);
		fill(plan.input);
		fill(plan.source);
		for (const t of plan.limit ?? []) fill(t.ref);
	}
	for (const r of final.values()) fill(r);

	return { layers: new Map(plans.map(({ layer, plan }) => [layer.id, plan])), slots, final };
}

/** Whether a layer's value is only a plain coverage where it sits (LayerMasks.coverageOnly). */
export function coverageOnlyAt(p: Project, layerId: string): boolean {
	const i = p.layers.findIndex((l) => l.id === layerId);
	if (i < 0 || !getLayerDef(p.layers[i].type)?.coverageOnly) return false;
	return planMasks(p, i).layers.get(layerId)?.coverageOnly ?? false;
}

/** Pattern sources (`value`) switched to Solid (`flat`): the changes, for a layer whose value is only a coverage. */
export function solidSources(params: ParamValues): ParamValues {
	return Object.fromEntries(SRC_KEYS.filter((k) => (params[k] ?? 'value') === 'value').map((k) => [k, 'flat']));
}

// ------------------------------------------------------------------------------------------------ material limits

/** A stored limit expression made valid (names trimmed, known ops, at most four terms), or undefined for none. */
export function sanitizeLimit(v: unknown): LimitExpr | undefined {
	if (!v || typeof v !== 'object') return undefined;
	const raw = v as { terms?: unknown; outside?: unknown };
	const terms = (Array.isArray(raw.terms) ? raw.terms : [])
		.map((t: { mask?: unknown; op?: unknown }) => ({
			mask: name(t?.mask),
			op: toLimitOp(t?.op)
		}))
		.filter((t) => t.mask)
		.slice(0, MAX_LIMIT_TERMS);
	return terms.length ? { terms, outside: raw.outside === true } : undefined;
}

/**
 * A member's own limit with its material's folded in (unpacking the material): own ∩ material where that stays one
 * left-to-right expression of at most four terms, else the own limit alone. X ∩ M appends M (and / minus); outside X ∩
 * outside M is outside X ∪ M; outside X ∩ M is M − X for a one-mask X.
 */
export function foldLimit(own: LimitExpr | null, mat: LimitExpr): LimitExpr {
	if (!own) return mat;
	const room = own.terms.length + mat.terms.length <= MAX_LIMIT_TERMS;
	const single = mat.terms.length === 1 ? mat.terms[0].mask : null;
	if (room && !own.outside && single)
		return { ...own, terms: [...own.terms, { mask: single, op: mat.outside ? 'minus' : 'and' }] };
	if (room && !own.outside && !mat.outside && mat.terms.every((t, i) => i === 0 || t.op !== 'or')) {
		return {
			...own,
			terms: [...own.terms, ...mat.terms.map((t, i) => ({ mask: t.mask, op: i === 0 ? ('and' as const) : t.op }))]
		};
	}
	if (room && own.outside && mat.outside && single)
		return { terms: [...own.terms, { mask: single, op: 'or' }], outside: true };
	if (room && own.outside && !mat.outside && single && own.terms.length === 1) {
		return {
			terms: [
				{ mask: single, op: 'and' },
				{ mask: own.terms[0].mask, op: 'minus' }
			],
			outside: false
		};
	}
	return own;
}
