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
	hiddenByMaterial,
	type Layer,
	type LimitExpr,
	type LimitOp,
	type Project,
	type SmartMaterial
} from '@/core/project';
import type { ParamValues } from '@/core/params';
import { MAX_LIMIT_TERMS } from './commonParams';
import { getLayerDef } from './registry';
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

/** A layer's own Limit to expression (lim_1 … lim_4, Invert), or null for none. */
export function layerLimit(params: ParamValues): LimitExpr | null {
	const terms: LimitExpr['terms'] = [];
	for (let n = 1; n <= MAX_LIMIT_TERMS; n++) {
		const mask = name(params[`lim_${n}`]);
		if (!mask) break;
		const op = n === 1 ? 'and' : (String(params[`lim_op${n}`] ?? 'and') as LimitOp);
		terms.push({ mask, op: op === 'or' || op === 'minus' ? op : 'and' });
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

/** A limit expression from short arguments: limitTo('Shape') · limitTo('Shape', { outside: true }) · ['Shape', '−', 'Opening']. */
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

/** Each layer's smart material (members only). */
function materialOf(p: Pick<Project, 'materials'>): Map<string, SmartMaterial> {
	const m = new Map<string, SmartMaterial>();
	for (const mat of p.materials ?? []) for (const id of Object.values(mat.members)) m.set(id, mat);
	return m;
}

/** Layers that run, in order: enabled and not hidden by their material. */
function running(p: Project): Layer[] {
	const hidden = hiddenByMaterial(p);
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
	return maskWriters(p, layerId, mask).map((l) => ({ name: l.name, op: String(l.params.mk_op ?? 'replace') }));
}

/** The layers whose writes `mask` holds when `layerId` runs, in stack order (see maskChain). */
export function maskWriters(p: Project, layerId: string, mask: string): Layer[] {
	const list = running(p);
	const chain: Layer[] = [];
	const at = p.layers.findIndex((l) => l.id === layerId);
	for (const l of list.filter((l) => p.layers.indexOf(l) < at).reverse()) {
		if (maskTarget(l.params) !== mask || !maskWriteKind(getLayerDef(l.type), l.params)) continue;
		chain.unshift(l);
		if (String(l.params.mk_op ?? 'replace') === 'replace') break;
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
	for (const m of p.materials ?? []) {
		const first = p.layers.find((l) => Object.values(m.members).includes(l.id));
		if (first) add(`material:${m.id}`, first.id, m.limit);
	}
	return links;
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
		const t = maskTarget(l.params);
		if (t && maskWriteKind(getLayerDef(l.type), l.params) && !names.includes(t)) names.push(t);
	}
	return names.sort((a, b) => (a === SHAPE_MASK ? -1 : b === SHAPE_MASK ? 1 : 0));
}

// ------------------------------------------------------------------------------------------------ the evaluation plan

/** A version of a mask a layer reads. slot −1: none — the mask is empty there (nothing wrote it yet). */
export interface MaskRef {
	mask: string;
	version: number;
	slot: number;
	/** Its distance is a true distance (only shapes wrote it, without Feather): edges read it directly. */
	exact: boolean;
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
	/** Its limit, flattened (Invert folded in); null = none. */
	limit: LimitTerm[] | null;
	/** Its source mask (edge filters, Mask area), or null. */
	source: MaskRef | null;
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
	const materials = materialOf(p);
	const list = running(p).filter((l) => p.layers.indexOf(l) <= upTo);
	// Current version of each mask, and whether it's exact.
	const current = new Map<string, { version: number; exact: boolean }>();
	const refOf = (mask: string): MaskRef => {
		const c = current.get(mask);
		return { mask, version: c?.version ?? 0, slot: -1, exact: c ? c.exact : true };
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
		const kind = maskWriteKind(def, params);
		const target = kind ? maskTarget(params)! : null;
		// A writer always reads its target (pixels it leaves keep it); other layers the Shape mask, if they read one at all.
		const input = target ? refOf(target) : def.readsMask ? refOf(SHAPE_MASK) : null;
		if (input) read(input, i);

		const own = layerLimit(params);
		const mat = materials.get(layer.id)?.limit;
		const flat = [...(own ? flatten(own, 0) : []), ...(mat?.terms.length ? flatten(mat, own ? 1 : 0) : [])];
		const limit = flat.length ? flat.map((t) => ({ ref: refOf(t.mask), op: t.op, neg: t.neg, group: t.group })) : null;
		for (const t of limit ?? []) read(t.ref, i);

		const srcName = def.maskSource?.(params) ?? null;
		const source = srcName ? refOf(srcName) : null;
		if (source) read(source, i);

		let write: LayerMasks['write'] = null;
		if (target && kind) {
			const prev = current.get(target);
			const feather = Number(params.mk_feather ?? 0) > 0;
			const replace = String(params.mk_op ?? 'replace') === 'replace';
			const exact = kind === 'shape' && !feather && (replace || !prev || prev.exact);
			const version = (prev?.version ?? 0) + 1;
			current.set(target, { version, exact });
			write = { mask: target, version, slot: -1, exact, kind };
		}
		plans.push({ layer, plan: { input, write, limit, source } });
	});

	// Every mask's last version stays to the end (the Masks view shows it).
	const final = new Map<string, MaskRef>();
	for (const [mask, c] of current) {
		final.set(mask, { mask, version: c.version, slot: -1, exact: c.exact });
		lastRead.set(`${mask}#${c.version}`, Infinity);
	}

	// Slots: a version gets one when written, if read later, and frees it after its last reader. A layer's own write may
	// take the slot of a version it was the last to read: the pipeline copies the write in after the layer has run.
	const slotOf = new Map<string, number>();
	const free: number[] = [];
	let slots = 0;
	const ends = new Map<number, string[]>();
	for (const [k, at] of lastRead) if (Number.isFinite(at)) ends.set(at, [...(ends.get(at) ?? []), k]);
	plans.forEach(({ plan }, i) => {
		for (const k of ends.get(i) ?? []) {
			const s = slotOf.get(k);
			if (s !== undefined) free.push(s);
		}
		free.sort((a, b) => b - a);
		const w = plan.write;
		if (w && lastRead.has(key(w))) {
			const s = free.length ? free.pop()! : slots++;
			slotOf.set(key(w), s);
			w.slot = s;
		}
	});
	const fill = (r: MaskRef | null) => {
		if (r && r.version > 0) r.slot = slotOf.get(key(r)) ?? -1;
	};
	for (const { plan } of plans) {
		fill(plan.input);
		fill(plan.source);
		for (const t of plan.limit ?? []) fill(t.ref);
	}
	for (const r of final.values()) fill(r);

	return { layers: new Map(plans.map(({ layer, plan }) => [layer.id, plan])), slots, final };
}

// ------------------------------------------------------------------------------------------------ material limits

/** A stored limit expression made valid (names trimmed, known ops, at most four terms), or undefined for none. */
export function sanitizeLimit(v: unknown): LimitExpr | undefined {
	if (!v || typeof v !== 'object') return undefined;
	const raw = v as { terms?: unknown; outside?: unknown };
	const terms = (Array.isArray(raw.terms) ? raw.terms : [])
		.map((t: { mask?: unknown; op?: unknown }) => ({
			mask: name(t?.mask),
			op: (['or', 'and', 'minus'].includes(String(t?.op)) ? t.op : 'and') as LimitOp
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
