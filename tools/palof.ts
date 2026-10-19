// Print the dark→light k-means palette (+ weights) and periods of reference PNGs, for hand-authoring.
//   npx tsx tools/palof.ts <png…> [--k 6]
import { readPng } from './png';
import { fromRgba8 } from '../src/match/image';
import { analyzeTarget } from '../src/match/analyze';
const args = process.argv.slice(2);
const ki = args.indexOf('--k');
const k = ki >= 0 ? Number(args[ki + 1]) : 6;
for (const f of args.filter((a, i) => !a.startsWith('--') && (ki < 0 || i !== ki + 1))) {
	const img = readPng(f);
	const a = analyzeTarget(fromRgba8(img.data, img.width, img.height), k);
	console.log(
		`${f.split('/').pop()!.padEnd(16)} ${img.width}x${img.height} pX ${a.periodX} pY ${a.periodY} meanL ${a.meanL.toFixed(2)}  ` +
			a.palette.map((c, i) => `${c}:${(a.weights[i] * 100).toFixed(0)}%`).join(' ')
	);
}
