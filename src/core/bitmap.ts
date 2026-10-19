// Small pixel bitmaps for the Stamp and Label generators, and polygon lists for Path (docs/features/fr7.5-stamps.md).
// A bitmap is up to 64×64 cells with four levels (0 = empty, 1..3 = filled); it is uploaded to the shader as
// `ivec4 u_<key>[64]` (2 bits per cell, 16 cells per int, row-major, top row first) + `ivec2 u_<key>_size`.

export const BITMAP_MAX = 64;

export interface Bitmap {
	width: number;
	height: number;
	/** Row-major levels 0..3, top row first. */
	levels: Uint8Array;
}

/** Cell character → level: '.', ' ', '0' empty · '-', '1' low · '+', '2' mid · anything else full. */
function levelOf(ch: string): number {
	if (ch === '.' || ch === ' ' || ch === '0') return 0;
	if (ch === '-' || ch === '1') return 1;
	if (ch === '+' || ch === '2') return 2;
	return 3;
}

function trimRows(rows: string[]): string[] {
	let a = 0;
	let b = rows.length;
	while (a < b && rows[a].trim() === '') a++;
	while (b > a && rows[b - 1].trim() === '') b--;
	return rows.slice(a, b);
}

/** Parses rows of cell characters (one row per line). */
export function parseBitmap(src: string): Bitmap {
	const rows = trimRows(src.replace(/\r/g, '').split('\n')).slice(0, BITMAP_MAX);
	const width = Math.min(
		BITMAP_MAX,
		rows.reduce((m, r) => Math.max(m, r.replace(/\s+$/, '').length), 0)
	);
	const height = rows.length;
	const levels = new Uint8Array(width * height);
	rows.forEach((r, y) => {
		for (let x = 0; x < Math.min(width, r.length); x++) levels[y * width + x] = levelOf(r[x]);
	});
	return { width, height, levels };
}

// 5-row pixel font: digits, capitals and a little punctuation; glyph rows joined by '/'.
const FONT: Record<string, string> = {
	'0': '###/#.#/#.#/#.#/###',
	'1': '.#./##./.#./.#./###',
	'2': '###/..#/###/#../###',
	'3': '###/..#/.##/..#/###',
	'4': '#.#/#.#/###/..#/..#',
	'5': '###/#../###/..#/###',
	'6': '###/#../###/#.#/###',
	'7': '###/..#/.#./.#./.#.',
	'8': '###/#.#/###/#.#/###',
	'9': '###/#.#/###/..#/###',
	A: '.#./#.#/###/#.#/#.#',
	B: '##./#.#/##./#.#/##.',
	C: '.##/#../#../#../.##',
	D: '##./#.#/#.#/#.#/##.',
	E: '###/#../##./#../###',
	F: '###/#../##./#../#..',
	G: '.##/#../#.#/#.#/.##',
	H: '#.#/#.#/###/#.#/#.#',
	I: '###/.#./.#./.#./###',
	J: '..#/..#/..#/#.#/.#.',
	K: '#.#/#.#/##./#.#/#.#',
	L: '#../#../#../#../###',
	M: '#...#/##.##/#.#.#/#...#/#...#',
	N: '#..#/##.#/#.##/#..#/#..#',
	O: '.#./#.#/#.#/#.#/.#.',
	P: '##./#.#/##./#../#..',
	Q: '.#./#.#/#.#/##./.##',
	R: '##./#.#/##./#.#/#.#',
	S: '.##/#../.#./..#/##.',
	T: '###/.#./.#./.#./.#.',
	U: '#.#/#.#/#.#/#.#/###',
	V: '#.#/#.#/#.#/#.#/.#.',
	W: '#...#/#...#/#.#.#/##.##/#...#',
	X: '#.#/#.#/.#./#.#/#.#',
	Y: '#.#/#.#/.#./.#./.#.',
	Z: '###/..#/.#./#../###',
	' ': '../../../../..',
	'-': '.../.../###/.../...',
	'.': '././././#',
	':': './#/./#/.',
	'/': '..#/..#/.#./#../#..',
	'!': '#/#/#/./#',
	'+': '.../.#./###/.#./...',
	'=': '.../###/.../###/...',
	'#': '#.#/###/#.#/###/#.#'
};

/** Renders text in the 5-row pixel font; lines split on '\n' or '|' and are centred. */
export function textBitmap(text: string, letterGap = 1, lineGap = 1): Bitmap {
	const lines = text
		.replace(/\r/g, '')
		.split(/\n|\|/)
		.map((l) => l.toUpperCase());
	const glyphRows = (ch: string) => (FONT[ch] ?? FONT['#']).split('/');
	const lineWidth = (l: string) => [...l].reduce((w, ch, i) => w + glyphRows(ch)[0].length + (i ? letterGap : 0), 0);
	const width = Math.min(
		BITMAP_MAX,
		lines.reduce((m, l) => Math.max(m, lineWidth(l)), 0)
	);
	const height = Math.min(BITMAP_MAX, lines.length * 5 + (lines.length - 1) * lineGap);
	const levels = new Uint8Array(width * height);
	lines.forEach((l, li) => {
		let x = Math.floor((width - lineWidth(l)) / 2);
		const y0 = li * (5 + lineGap);
		for (const ch of l) {
			const g = glyphRows(ch);
			g.forEach((row, gy) => {
				for (let gx = 0; gx < row.length; gx++) {
					const px = x + gx;
					const py = y0 + gy;
					if (row[gx] === '#' && px >= 0 && px < width && py < height) levels[py * width + px] = 3;
				}
			});
			x += g[0].length + letterGap;
		}
	});
	return { width, height, levels };
}

/** Packs a bitmap into the shader layout: 64 rows × ivec4 (2 bits per cell). */
export function packBitmap(b: Bitmap): Int32Array {
	const out = new Int32Array(BITMAP_MAX * 4);
	for (let y = 0; y < Math.min(b.height, BITMAP_MAX); y++) {
		for (let x = 0; x < Math.min(b.width, BITMAP_MAX); x++) {
			const v = b.levels[y * b.width + x] & 3;
			if (v) out[y * 4 + (x >> 4)] |= v << ((x & 15) * 2);
		}
	}
	return out;
}

export const MAX_PATH_POINTS = 64;

/** Polygons for the Path generator: "x,y x,y …" per polygon, polygons separated by new lines or '|'. */
export function parsePolygons(src: string): number[][][] {
	return src
		.split(/\n|\|/)
		.map((line) =>
			(line.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [])
				.map(Number)
				.reduce<number[][]>((pts, v, i) => (i % 2 ? (pts[pts.length - 1].push(v), pts) : (pts.push([v]), pts)), [])
				.filter((p) => p.length === 2)
		)
		.filter((poly) => poly.length >= 3);
}

/** Open polylines (Polyline layers, pipe runs): the same text format, two or more points each. */
export function parsePolylines(src: string): number[][][] {
	return src
		.split(/\n|\|/)
		.map((line) =>
			(line.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [])
				.map(Number)
				.reduce<number[][]>((pts, v, i) => (i % 2 ? (pts[pts.length - 1].push(v), pts) : (pts.push([v]), pts)), [])
				.filter((p) => p.length === 2)
		)
		.filter((line) => line.length >= 2);
}

/** Packs polygons as vec4 (x, y, next vertex index, polygon index); returns the data and the vertex count. */
export function packPolygons(polys: number[][][]): { data: Float32Array; count: number; polygons: number } {
	const data = new Float32Array(MAX_PATH_POINTS * 4);
	let n = 0;
	let k = 0;
	for (const poly of polys) {
		if (n + poly.length > MAX_PATH_POINTS) break;
		const first = n;
		poly.forEach(([x, y], i) => {
			data.set([x, y, i === poly.length - 1 ? first : n + 1, k], n * 4);
			n++;
		});
		k++;
	}
	return { data, count: n, polygons: k };
}
