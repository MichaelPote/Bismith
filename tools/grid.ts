// Grid contact sheet of many PNGs (nearest-scaled to fit a cell, aspect kept), for surveying texture sets.
//   npx tsx tools/grid.ts <out.png> --cell 64 --cols 16 <files…>   (or --list file.txt with one path per line)

import { readFileSync } from 'node:fs';
import { num, parseArgs, str } from './args';
import { chunk, gridSheet, readPng, writePng, type Rgba8 } from './png';

const args = parseArgs();
const cell = num(args, 'cell', 64);
const cols = num(args, 'cols', 16);
const list = str(args, 'list', '');
const [out, ...rest] = args.positional;
const files = list ? readFileSync(list, 'utf8').split('\n').filter(Boolean) : rest;
const read = (f: string): Rgba8 | null => {
	try {
		return readPng(f);
	} catch {
		return null;
	}
};
// Every row padded to `cols`, so the sheet is as wide as asked; an unreadable file leaves its cell empty.
const rows = chunk(files.map(read), cols).map((r) => [...r, ...Array<null>(cols - r.length).fill(null)]);
const sheet = gridSheet(rows, { cell, gap: 4 });
writePng(out, sheet);
console.log(`grid ${files.length} → ${out} (${sheet.width}×${sheet.height})`);
