// Small pixel bitmaps and the pixel font for the Stamp and Label generators (read on the CPU), and polygon lists for
// Path and Polyline (uploaded as vertex uniforms; docs/features/fr7.5-stamps.md).

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

/** Parses rows of cell characters (one row per line), up to `max` × `max` cells. */
export function parseBitmap(src: string, max: number): Bitmap {
	const rows = trimRows(src.replace(/\r/g, '').split('\n')).slice(0, max);
	const width = Math.min(
		max,
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
export const FONT: Record<string, string> = {
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

/** The polygons (or polylines) that fit in MAX_PATH_POINTS vertices: those before the first that would overflow. */
export function takePolygons(polys: number[][][]): number[][][] {
	let n = 0;
	const out: number[][][] = [];
	for (const poly of polys) {
		if (n + poly.length > MAX_PATH_POINTS) break;
		out.push(poly);
		n += poly.length;
	}
	return out;
}

/** Packs polygons as vec4 (x, y, next vertex index, polygon index); returns the data and the vertex count. */
export function packPolygons(polys: number[][][]): { data: Float32Array; count: number; polygons: number } {
	const data = new Float32Array(MAX_PATH_POINTS * 4);
	let n = 0;
	let k = 0;
	for (const poly of takePolygons(polys)) {
		const first = n;
		poly.forEach(([x, y], i) => {
			data.set([x, y, i === poly.length - 1 ? first : n + 1, k], n * 4);
			n++;
		});
		k++;
	}
	return { data, count: n, polygons: k };
}
