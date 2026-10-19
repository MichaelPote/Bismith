// Prints a PNG region as ASCII luminance levels — for tracing pixel-art motifs into Stamp bitmaps.
//
//   npx tsx tools/ascii.ts <png> [--x 0 --y 0 --w 64 --h 64] [--levels " .:-=+*#%@"] [--cut 0.3] [--invert] [--mean]
//
// --cut prints a two-level mask ('#' where luminance is below the cut, or above with --invert) ready for a Stamp.
// --mean prints only the region's mean colour and its dark / light quartile means (for picking layer colours).

import { readPng } from './png';

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => {
	const i = args.indexOf(`--${n}`);
	return i >= 0 ? args[i + 1] : d;
};
const img = readPng(args[0]);
const x0 = Number(flag('x', '0'));
const y0 = Number(flag('y', '0'));
const w = Number(flag('w', String(img.width - x0)));
const h = Number(flag('h', String(img.height - y0)));
const ramp = flag('levels', ' .:-=+*#%@')!;
const cut = flag('cut');
const invert = args.includes('--invert');
const lum = (x: number, y: number) => {
	const i = (y * img.width + x) * 4;
	return (0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 255;
};
const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
if (args.includes('--mean')) {
	const px: { l: number; c: number[] }[] = [];
	for (let y = y0; y < y0 + h; y++)
		for (let x = x0; x < x0 + w; x++) {
			const i = (y * img.width + x) * 4;
			px.push({ l: lum(x, y), c: [img.data[i], img.data[i + 1], img.data[i + 2]] });
		}
	px.sort((a, b) => a.l - b.l);
	const avg = (s: typeof px) => [0, 1, 2].map((k) => s.reduce((t, p) => t + p.c[k], 0) / Math.max(1, s.length));
	const q = Math.max(1, Math.floor(px.length / 4));
	console.log(`mean ${hex(avg(px))}  dark ${hex(avg(px.slice(0, q)))}  light ${hex(avg(px.slice(-q)))}`);
	process.exit(0);
}
let lo = 1;
let hi = 0;
for (let y = y0; y < y0 + h; y++)
	for (let x = x0; x < x0 + w; x++) {
		const l = lum(x, y);
		lo = Math.min(lo, l);
		hi = Math.max(hi, l);
	}
const header = '    ' + Array.from({ length: w }, (_, i) => String((x0 + i) % 10)).join('');
console.log(header);
for (let y = y0; y < y0 + h; y++) {
	let row = '';
	for (let x = x0; x < x0 + w; x++) {
		const l = lum(x, y);
		if (cut !== undefined) row += (invert ? l > Number(cut) : l < Number(cut)) ? '#' : '.';
		else row += ramp[Math.min(ramp.length - 1, Math.floor(((l - lo) / Math.max(hi - lo, 1e-6)) * ramp.length))];
	}
	console.log(String(y).padStart(3) + ' ' + row);
}
