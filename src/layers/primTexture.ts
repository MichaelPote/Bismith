// Primitive textures (Pipework, Liquid splats): primitives built on the CPU and handed to the shader as an RGBA8
// texture of fixed-point records, with a grid of per-cell lists so a pixel loops over only the primitives near it.
//
// Layout: rows of PRIM_ROW texels. Records of `stride` texels never straddle a row (a row holds ⌊PRIM_ROW / stride⌋ of
// them), so record i is at recAt(i, stride). From the row after the last record: the cell table and the lists,
// addressed linearly (texelAt). Values: two u16 a texel (high byte first), a u32 a texel (high half first), or bytes.
// Lengths are in units of `unit` px — a power of two, 1 unless the layout is too large for the fixed point at 1:
// positions and offsets are (v / unit + 4096) × 8 (within ±4096 units, to 1/8), sizes v / unit × their scale.
// Where the table and lists start, the grid and the unit go to the shader as derived uniforms (PRIM_UNIFORMS).

import type { CpuTexture, DerivedUniformType } from './types';

export const PRIM_ROW = 1024;

/** The least power of two (≥ 1) that keeps every [largest value, most the encoding holds at unit 1] in range. */
export function fitUnit(...ranges: [number, number][]): number {
	const need = ranges.reduce((m, [v, max]) => Math.max(m, v / max), 0);
	let unit = 1;
	while (unit < need) unit *= 2;
	return unit;
}

/** Most a position or offset holds at unit 1 (px either way). */
export const POS_RANGE = 4095;
/** Most a size holds at unit 1 when stored × scale. */
export const sizeRange = (scale: number) => 65535 / scale;

/** The per-cell lists: a grid over the texture, and for each cell the primitives that can reach it, in their order. */
export interface PrimBins {
	gw: number;
	gh: number;
	lists: number[][];
	/** Texels the cell table and the lists take. */
	texels: number;
}

/**
 * Bins primitives by how far from their anchor (x, y) they matter (reach, px): every cell a primitive's reach touches
 * lists it. Cells are about half the median reach across (at most 128 × 128). When tiling, the cells wrap with the
 * texture (and the anchors with them); otherwise the edge cells reach on outwards.
 */
export function binByReach(
	items: { x: number; y: number; reach: number }[],
	c: { width: number; height: number; tile: boolean }
): PrimBins {
	const { width: W, height: H, tile } = c;
	const sorted = items.map((p) => p.reach).sort((a, b) => a - b);
	const cell = Math.max(4, 0.5 * (sorted[Math.floor(sorted.length / 2)] ?? 8));
	const gw = Math.max(1, Math.min(128, Math.round(W / cell)));
	const gh = Math.max(1, Math.min(128, Math.round(H / cell)));
	const cw = W / gw;
	const ch = H / gh;
	const lists: number[][] = Array.from({ length: gw * gh }, () => []);
	/** Distance from v to cell i of `size` along one axis (with the edge cells open outwards untiled). */
	const gap = (v: number, i: number, size: number, count: number, span: number) => {
		const lo = i * size;
		const hi = lo + size;
		if (tile) {
			const c = lo + 0.5 * size;
			const w = v - span * Math.round((v - c) / span);
			return Math.max(0, Math.abs(w - c) - 0.5 * size);
		}
		if (v < lo) return i === 0 ? 0 : lo - v;
		if (v > hi) return i === count - 1 ? 0 : v - hi;
		return 0;
	};
	items.forEach((p, idx) => {
		const r = p.reach;
		// The cells r reaches: around the torus when tiling (all of them once r spans it), clamped to the grid otherwise.
		const range = (v: number, size: number, count: number) => {
			let i0 = Math.floor((v - r) / size);
			let i1 = Math.floor((v + r) / size);
			if (tile) {
				if (i1 - i0 + 1 >= count) return [0, count - 1, false] as const;
				return [i0, i1, true] as const;
			}
			i0 = Math.max(0, Math.min(count - 1, i0));
			i1 = Math.max(0, Math.min(count - 1, i1));
			return [i0, i1, false] as const;
		};
		const [x0, x1, wx] = range(p.x, cw, gw);
		const [y0, y1, wy] = range(p.y, ch, gh);
		for (let yi = y0; yi <= y1; yi++) {
			const cy = wy ? ((yi % gh) + gh) % gh : yi;
			const dy = gap(p.y, cy, ch, gh, H);
			if (dy > r) continue;
			for (let xi = x0; xi <= x1; xi++) {
				const cx = wx ? ((xi % gw) + gw) % gw : xi;
				if (Math.hypot(gap(p.x, cx, cw, gw, W), dy) > r) continue;
				const list = lists[cx + cy * gw];
				// (A wide primitive can reach one cell from both sides round the torus.)
				if (list[list.length - 1] !== idx) list.push(idx);
			}
		}
	});
	const entries = lists.reduce((s, l) => s + l.length, 0);
	return { gw, gh, lists, texels: gw * gh + 1 + Math.ceil(entries / 2) };
}

/** A primitive texture and what the shader needs to read it (PRIM_UNIFORMS). */
export interface PrimTexture {
	texture: CpuTexture;
	/** Records in it. */
	count: number;
	unit: number;
	grid: [number, number];
	/** The texels (linear) where the cell table and the lists start. */
	table: number;
	list: number;
}

/** Writes records of `stride` texels, then the bins' cell table and lists. */
export class PrimWriter {
	private readonly per: number;
	readonly data: Uint8Array;
	private readonly table: number;

	constructor(
		readonly stride: number,
		readonly count: number,
		private readonly bins: PrimBins,
		readonly unit = 1
	) {
		this.per = Math.floor(PRIM_ROW / stride);
		this.table = Math.ceil(count / this.per) * PRIM_ROW;
		this.data = new Uint8Array(PRIM_ROW * Math.ceil((this.table + bins.texels) / PRIM_ROW) * 4);
	}

	/** The first texel (linear) of record i. */
	rec(i: number): number {
		return Math.floor(i / this.per) * PRIM_ROW + (i % this.per) * this.stride;
	}
	u8(t: number, ch: number, v: number): void {
		this.data[t * 4 + ch] = Math.max(0, Math.min(255, Math.round(v)));
	}
	u16(t: number, slot: number, v: number): void {
		const q = Math.max(0, Math.min(65535, Math.round(v)));
		this.data[t * 4 + slot * 2] = q >> 8;
		this.data[t * 4 + slot * 2 + 1] = q & 255;
	}
	u32(t: number, v: number): void {
		this.u16(t, 0, Math.floor(v / 65536));
		this.u16(t, 1, v % 65536);
	}
	/** A position or offset (px). */
	pos(t: number, slot: number, v: number): void {
		this.u16(t, slot, (Math.max(-4096, Math.min(POS_RANGE, v / this.unit)) + 4096) * 8);
	}
	/** A size (px), stored × scale. */
	size(t: number, slot: number, v: number, scale: number): void {
		this.u16(t, slot, (v / this.unit) * scale);
	}
	/** An angle in −range..range. */
	ang(t: number, slot: number, a: number, range: number): void {
		this.u16(t, slot, ((a / range) * 0.5 + 0.5) * 65535);
	}
	/** A unit vector, a whole texel. */
	unitVec(t: number, x: number, y: number): void {
		this.u16(t, 0, (x + 1) * 32767.5);
		this.u16(t, 1, (y + 1) * 32767.5);
	}

	/** Writes the cell table (where each cell's list starts, and one more for where the last ends) and the lists. */
	finish(): PrimTexture {
		const { gw, gh, lists } = this.bins;
		const list = this.table + gw * gh + 1;
		let e = 0;
		lists.forEach((l, c) => {
			this.u32(this.table + c, e);
			for (const idx of l) this.u16(list + (e >> 1), e++ & 1, idx);
		});
		this.u32(this.table + gw * gh, e);
		return {
			texture: { width: PRIM_ROW, height: this.data.length / (4 * PRIM_ROW), data: this.data },
			count: this.count,
			unit: this.unit,
			grid: [gw, gh],
			table: this.table,
			list
		};
	}
}

/** LayerDef.derivedUniforms declarations for reading a primitive texture: d_unit, d_grid, d_table, d_list. */
export const PRIM_UNIFORMS: Record<string, DerivedUniformType> = {
	unit: 'float',
	grid: 'ivec2',
	table: 'int',
	list: 'int'
};
export const primUniforms = (t: PrimTexture) => ({ unit: t.unit, grid: t.grid, table: t.table, list: t.list });

/** Reads a primitive texture back (tests). */
export class TexelReader {
	constructor(readonly t: PrimTexture) {}
	u8(texel: number, ch: number): number {
		return this.t.texture.data[texel * 4 + ch];
	}
	u16(texel: number, slot: number): number {
		return this.u8(texel, slot * 2) * 256 + this.u8(texel, slot * 2 + 1);
	}
	u32(texel: number): number {
		return this.u16(texel, 0) * 65536 + this.u16(texel, 1);
	}
	pos(texel: number, slot: number): number {
		return (this.u16(texel, slot) / 8 - 4096) * this.t.unit;
	}
	/** The first texel of record i (records of `stride` texels). */
	rec(i: number, stride: number): number {
		const per = Math.floor(PRIM_ROW / stride);
		return Math.floor(i / per) * PRIM_ROW + (i % per) * stride;
	}
	/** The records listed for the cell q (px) is in, as the shader picks it (cellRange) on canvas c. */
	cellList(qx: number, qy: number, c: { width: number; height: number; tile: boolean }): number[] {
		const [gw, gh] = this.t.grid;
		let cx = Math.floor(qx / (c.width / gw));
		let cy = Math.floor(qy / (c.height / gh));
		cx = c.tile ? ((cx % gw) + gw) % gw : Math.min(gw - 1, Math.max(0, cx));
		cy = c.tile ? ((cy % gh) + gh) % gh : Math.min(gh - 1, Math.max(0, cy));
		const k = this.t.table + cx + cy * gw;
		const out: number[] = [];
		for (let e = this.u32(k); e < this.u32(k + 1); e++) out.push(this.u16(this.t.list + (e >> 1), e & 1));
		return out;
	}
}

/** Floats as an RGBA8 texture `width` texels across, one per texel (its bits, little-endian): texF32 reads them back. */
export function floatTexture(f: Float32Array, width: number): CpuTexture {
	const height = Math.max(1, Math.ceil(f.length / width));
	const data = new Uint8Array(width * height * 4);
	const dv = new DataView(data.buffer);
	f.forEach((x, i) => dv.setFloat32(i * 4, x, true));
	return { width, height, data };
}

/**
 * GLSL for reading a primitive texture (interpolate it into the layer's shader): bytes, u16, u32 and float32 texels,
 * record and linear addresses, fixed-point positions (× the unit un), angles and unit vectors, and a cell's list.
 */
export const GLSL_PRIMTEX = /* glsl */ `
const int PRIM_ROW = ${PRIM_ROW};
float texU8(float c) { return floor(c * 255.0 + 0.5); }
float texU16(vec2 b) { return texU8(b.x) * 256.0 + texU8(b.y); }
vec2 texU16x2(vec4 t) { return vec2(texU16(t.rg), texU16(t.ba)); }
int texU32(vec4 t) { return int(texU16(t.rg)) * 65536 + int(texU16(t.ba)); }
// A float32 stored as its bits (little-endian bytes).
float texF32(sampler2D s, ivec2 c) {
  uvec4 b = uvec4(texelFetch(s, c, 0) * 255.0 + 0.5);
  return uintBitsToFloat(b.x | (b.y << 8) | (b.z << 16) | (b.w << 24));
}
// Record i's first texel (records of stride texels, never across a row), and linear texel t's.
ivec2 recAt(int i, int stride) { int per = PRIM_ROW / stride; return ivec2((i % per) * stride, i / per); }
ivec2 texelAt(int t) { return ivec2(t & (PRIM_ROW - 1), t >> 10); }
vec2 texPos(vec4 t, float un) { return (texU16x2(t) / 8.0 - 4096.0) * un; }
float texAng(vec2 b, float range) { return (texU16(b) / 65535.0 * 2.0 - 1.0) * range; }
vec2 texUnitVec(vec4 t) { return texU16x2(t) / 32767.5 - 1.0; }
// The entries [x, y) of the list of q's cell (grid G, wrapping with the texture when tiling; table: d_table).
ivec2 cellRange(sampler2D s, vec2 q, ivec2 G, int table) {
  ivec2 c = ivec2(floor(q / (uRes / vec2(G))));
  c = uTile ? imod(c, G) : clamp(c, ivec2(0), G - 1);
  int k = table + c.x + c.y * G.x;
  return ivec2(texU32(texelFetch(s, texelAt(k), 0)), texU32(texelFetch(s, texelAt(k + 1), 0)));
}
// The record index of a list's entry e (list: d_list).
int listItem(sampler2D s, int list, int e) {
  vec4 l = texelFetch(s, texelAt(list + (e >> 1)), 0);
  return int(texU16((e & 1) == 0 ? l.rg : l.ba));
}
`;
