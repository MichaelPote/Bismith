// Batch emulation of reference textures (docs/features/fr7.3-emulation.md).
//
//   npx tsx tools/emulate.ts <dir|files…> [--out harness-out/emulate/<name>] [--workers 6]
//        [--palette auto|quake|doom|none] [--only <regex>] [--limit N] [--resume]
//        [--screen 24] [--top 3] [--race 120] [--evals 600] [--samples 8] [--final 128]
//        [--templates a,b,c] [--seed N] [--backend windows|swiftshader] [--no-memory] [--memory dir1,dir2]
//        [--until LOSS] [--time SECONDS] [--patience STEPS] [--no-colour-fit] [--no-texture]
//
// --until / --time keep each target's final optimisation going until its search loss reaches LOSS or SECONDS of
// wall-clock time (per target) are used; --evals then caps each finalist only when given. A finalist that stalls
// (--patience steps without progress, default 80) hands the remaining time to the next raced template.
//
// Each target is analysed and emulated in a headless page (GPU by default): every template is screened with a
// short optimisation, the best few race, the winner is optimised further and rendered at --final samples.
// Writes per target: <name>.json (project), <name>.png (render), <name>.sheet.png (target | render | diff),
// <name>.result.json (scores, template ranking, analysis); plus index.json and gallery.html for the set.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { expandInputs, num, parseArgs, str } from './args';
import { openSession, type BackendKind } from './backend';
import { gridSheet, pngFromDataUrl as png, readPng, rgbaTarget, writePng } from './png';
import type { HeadlessEmulateResult } from '../src/headless';
import type { EmulateOptions } from '../src/match/emulate';
import { DOOM_PALETTE, QUAKE_PALETTE } from '../src/render/post/palettes';
import { analyzeTarget, type Analysis } from '../src/match/analyze';
import { fromRgba8 } from '../src/match/image';
import { hexToRgb, srgbToOklab } from '../src/core/color';
import type { Project } from '../src/core/project';

function plte(file: string): string[] {
	const b = readFileSync(file);
	let off = 8;
	while (off + 8 < b.length) {
		const len = b.readUInt32BE(off);
		const type = b.toString('ascii', off + 4, off + 8);
		if (type === 'PLTE') {
			const cols: string[] = [];
			for (let i = 0; i < len; i += 3)
				cols.push(
					'#' + [b[off + 8 + i], b[off + 9 + i], b[off + 10 + i]].map((v) => v.toString(16).padStart(2, '0')).join('')
				);
			return cols;
		}
		if (type === 'IDAT') break;
		off += 12 + len;
	}
	return [];
}

/** Pick the built-in palette that exactly matches the files' PLTE chunk. */
function detectPalette(file: string): string {
	const p = plte(file).join(',').toLowerCase();
	if (!p) return '';
	if (p === QUAKE_PALETTE.join(',').toLowerCase()) return 'quake';
	if (p === DOOM_PALETTE.join(',').toLowerCase()) return 'doom';
	return '';
}

// ------------------------------------------------------------------------------------------------ memory
// Experience replay: every finished emulation is remembered with its analysis; new targets also try the
// winning projects of their nearest neighbours (resized), and near-duplicates (texture variants) get a short
// search seeded mostly from memory.

interface MemoryItem {
	name: string;
	analysis: Analysis;
	template: string;
	loss: number;
	project: Project;
}

function paletteLab(a: Analysis): [number, number, number][] {
	return a.palette.map((h) => srgbToOklab(hexToRgb(h)));
}

/** Rough perceptual + structural distance between two analyses (0 = alike). */
function analysisDistance(a: Analysis, b: Analysis): number {
	const pa = paletteLab(a);
	const pb = paletteLab(b);
	let dc = 0;
	const n = Math.min(pa.length, pb.length);
	for (let i = 0; i < n; i++)
		dc += Math.hypot(pa[i][0] - pb[i][0], (pa[i][1] - pb[i][1]) * 2, (pa[i][2] - pb[i][2]) * 2);
	dc /= Math.max(1, n);
	const per = (x: number, y: number) => (x && y ? Math.abs(Math.log2(x / y)) : x || y ? 1 : 0);
	const ds = per(a.periodX, b.periodX) * 0.1 + per(a.periodY, b.periodY) * 0.1;
	const de =
		Math.abs(a.stdL - b.stdL) * 2 +
		Math.abs(Math.log((a.edgeX + 1e-3) / (a.edgeY + 1e-3)) - Math.log((b.edgeX + 1e-3) / (b.edgeY + 1e-3))) * 0.1;
	const dsz = a.width === b.width && a.height === b.height ? 0 : 0.05;
	return dc + ds + de + dsz;
}

function resizeProject(p: Project, w: number, h: number): Project {
	return { ...structuredClone(p), width: w, height: h };
}

/** Sort key: group heads (variant 0 / 01) first so their variants can draw on memory. */
function variantRank(name: string): number {
	const m = name.match(/_(\w+)$/) ?? name.match(/(\d+)$/);
	if (!m) return 0;
	const v = m[1];
	const n = /^\d+$/.test(v) ? Number(v) : parseInt(v, 36);
	return Number.isFinite(n) ? n : 0;
}

interface IndexEntry {
	name: string;
	source: string;
	width: number;
	height: number;
	template: string;
	loss: number;
	terms: Record<string, number>;
	evaluations: number;
	ms: number;
}

/** Family key: the `X00_18` prefix of coded names (X00_18_3 → X00_18), the first five letters of 8-character
 *  WAD-style names (BRICKA01 → BRICK), otherwise the name without trailing digits (wall2_1 → wall). */
function familyOf(name: string): string {
	const m = name.match(/^([A-Z]\w\w_\w\w)_/);
	if (m) return m[1];
	if (/^[A-Z][A-Z0-9+_]{7}$/.test(name)) return name.slice(0, 5);
	return name.replace(/[\d_]+$/, '').replace(/\d+$/, '') || name;
}

function html(set: string, entries: IndexEntry[]): string {
	const fams = new Map<string, IndexEntry[]>();
	for (const e of entries) {
		const f = familyOf(e.name);
		if (!fams.has(f)) fams.set(f, []);
		fams.get(f)!.push(e);
	}
	const q = (loss: number) => Math.max(0, Math.min(1, 1 - loss / 0.6)).toFixed(2);
	const card = (e: IndexEntry) => `<figure class="card">
  <div class="pair"><img loading="lazy" src="targets/${e.name}.png" alt="${e.name} target" title="target ${e.width}×${e.height}"><img loading="lazy" src="${e.name}.png" alt="${e.name} emulation" title="emulation"></div>
  <figcaption><b>${e.name}</b><span>${e.template}</span><span class="loss" style="--q:${q(e.loss)}">${e.loss.toFixed(3)}</span></figcaption>
</figure>`;
	const sections = [...fams]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([f, es]) => {
			const m = es.reduce((s, e) => s + e.loss, 0) / es.length;
			return `<section><h2>${f} <span class="meta">${es.length} · mean <span class="loss" style="--q:${q(m)}">${m.toFixed(3)}</span></span></h2><div class="cards">${es.map(card).join('\n')}</div></section>`;
		})
		.join('\n');
	const mean = entries.reduce((s, e) => s + e.loss, 0) / Math.max(1, entries.length);
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${set} emulation</title>
<style>
:root{--void:#17191c;--panel:#24282c;--line:#363c41;--text:#d7d6d0;--hi:#f1efe9;--lo:#8f989e;--ember:#ff9019}
body{margin:0;background:var(--void);color:var(--text);font:13px/1.4 'IBM Plex Sans',system-ui,sans-serif}
header{padding:20px 24px;border-bottom:1px solid var(--line);display:flex;gap:24px;align-items:baseline;flex-wrap:wrap}
h1{margin:0;font:600 22px 'Cormorant Garamond',Georgia,serif;letter-spacing:.12em;text-transform:uppercase;color:var(--hi)}
h2{margin:18px 24px 6px;font:500 14px 'IBM Plex Mono',monospace;color:var(--hi)}
.meta{color:var(--lo);font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:400}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;padding:0 24px}
.card{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:6px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.pair img{width:100%;aspect-ratio:1;object-fit:contain;image-rendering:pixelated;background:#111316}
figcaption{display:flex;gap:8px;align-items:baseline;margin-top:5px;font-size:12px}
figcaption b{color:var(--hi);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
figcaption span{color:var(--lo);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.loss{margin-left:auto;font-family:'IBM Plex Mono',monospace;color:color-mix(in oklab,#e0503f,#8fbf7f calc(var(--q)*100%))!important}
</style></head><body>
<header><h1>${set}</h1><span class="meta">${entries.length} textures · ${fams.size} families · mean loss ${mean.toFixed(3)} · left target, right emulation</span></header>
${sections}
<div style="height:40px"></div></body></html>`;
}

async function main() {
	const args = parseArgs(process.argv.slice(2), ['resume', 'no-memory', 'no-colour-fit', 'no-texture']);
	let files = expandInputs(args.positional, (f) => extname(f).toLowerCase() === '.png');
	const only = str(args, 'only');
	if (only !== undefined) {
		const re = new RegExp(only, 'i');
		files = files.filter((f) => re.test(basename(f)));
	}
	const limit = num(args, 'limit');
	if (limit !== undefined) files = files.slice(0, limit);
	if (!args.flags['no-memory'])
		files = [...files].sort(
			(a, b) => variantRank(basename(a, '.png')) - variantRank(basename(b, '.png')) || a.localeCompare(b)
		);
	if (!files.length) throw new Error('no input PNGs');
	const outFlag = str(args, 'out');
	const set = outFlag !== undefined ? basename(outFlag) : basename(resolve(args.positional[0]));
	const out = resolve(outFlag ?? join('harness-out/emulate', set));
	mkdirSync(join(out, 'targets'), { recursive: true });
	const paletteFlag = str(args, 'palette', 'auto');
	const palette = paletteFlag === 'auto' ? detectPalette(files[0]) : paletteFlag === 'none' ? '' : paletteFlag;
	const seconds = num(args, 'time');
	const opts: EmulateOptions = {
		palette,
		samples: num(args, 'samples', 8),
		finalSamples: num(args, 'final', 128),
		screenEvals: num(args, 'screen', 24),
		raceTop: num(args, 'top', 3),
		raceEvals: num(args, 'race', 120),
		evals: num(args, 'evals') ?? (args.flags.until || args.flags.time ? undefined : 600),
		targetLoss: num(args, 'until'),
		timeMs: seconds !== undefined ? seconds * 1000 : undefined,
		patience: num(args, 'patience'),
		seed: num(args, 'seed', 1),
		fitColours: !args.flags['no-colour-fit'],
		// --no-texture: the pre-FR8 metric (no VGG texture term, structure weighted as before).
		metric: args.flags['no-texture']
			? {
					weights: {
						colour: 1.25,
						spectrum: 0.5,
						gradients: 0.35,
						contrast: 0.5,
						aligned: 0,
						structure: 3.5,
						texture: 0,
						alpha: 0
					}
				}
			: undefined,
		templates: str(args, 'templates')?.split(',')
	};
	const workers = Math.max(1, Math.min(files.length, num(args, 'workers', 4)));
	const s = await openSession({ backend: str(args, 'backend') as BackendKind | undefined, workers, logPage: true });
	console.log(
		`[${s.backend}] ${s.renderer} · ${workers} workers · ${files.length} targets · palette ${palette || 'none'} → ${out}`
	);

	const indexFile = join(out, 'index.json');
	const index = new Map<string, IndexEntry>();
	if (existsSync(indexFile))
		for (const e of JSON.parse(readFileSync(indexFile, 'utf8')) as IndexEntry[]) index.set(e.name, e);
	const saveIndex = () => {
		const entries = [...index.values()].sort((a, b) => a.name.localeCompare(b.name));
		writeFileSync(indexFile, JSON.stringify(entries, null, 1));
		writeFileSync(join(out, 'gallery.html'), html(set, entries));
	};

	const memory: MemoryItem[] = [];
	const useMemory = !args.flags['no-memory'];
	const remember = (dir: string) => {
		if (!existsSync(join(dir, 'index.json'))) return;
		for (const e of JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as IndexEntry[]) {
			const rf = join(dir, `${e.name}.result.json`);
			const pf = join(dir, `${e.name}.json`);
			if (!existsSync(rf) || !existsSync(pf)) continue;
			const r = JSON.parse(readFileSync(rf, 'utf8')) as { analysis: Analysis; template: string; loss: number };
			memory.push({
				name: e.name,
				analysis: r.analysis,
				template: r.template,
				loss: r.loss,
				project: JSON.parse(readFileSync(pf, 'utf8'))
			});
		}
	};
	if (useMemory) {
		remember(out);
		for (const d of str(args, 'memory')?.split(',') ?? []) remember(resolve(d));
		if (memory.length) console.log(`memory: ${memory.length} past results`);
	}

	let next = 0;
	let done = 0;
	const t0 = Date.now();
	const work = async (w: number) => {
		for (;;) {
			const i = next++;
			if (i >= files.length) return;
			const file = files[i];
			const name = basename(file, extname(file));
			if (args.flags.resume && index.has(name) && existsSync(join(out, `${name}.json`))) {
				done++;
				continue;
			}
			try {
				const img = readPng(file);
				copyFileSync(file, join(out, 'targets', `${name}.png`));
				const target = rgbaTarget(img);
				const seed = opts.seed! + (parseInt(createHash('md5').update(name).digest('hex').slice(0, 6), 16) % 1000);
				let jobOpts: EmulateOptions = { ...opts, seed };
				let note = '';
				if (useMemory && memory.length) {
					const a = analyzeTarget(fromRgba8(img.data, img.width, img.height));
					const near = memory
						.filter((m) => m.name !== name)
						.map((m) => ({ m, d: analysisDistance(a, m.analysis) }))
						.sort((x, y) => x.d - y.d)
						.slice(0, 3);
					if (near.length) {
						const seeds = near.map(({ m }) => ({
							id: `memory:${m.name}`,
							project: resizeProject(m.project, img.width, img.height)
						}));
						jobOpts = { ...jobOpts, seeds };
						if (near[0].d < 0.12) {
							// A near-duplicate: its template plus the memory seeds, shorter search.
							const tpl = near[0].m.template.startsWith('memory:') ? undefined : [near[0].m.template];
							jobOpts = {
								...jobOpts,
								templates: tpl ?? [],
								raceTop: 2,
								raceEvals: Math.round((opts.raceEvals ?? 120) / 2),
								evals: opts.evals !== undefined ? Math.round(opts.evals * 0.6) : undefined
							};
						}
						note = ` · near ${near[0].m.name} (${near[0].d.toFixed(2)})`;
					}
				}
				const r = await s.callOn<HeadlessEmulateResult>(w, 'emulate', target, jobOpts);
				writeFileSync(join(out, `${name}.json`), JSON.stringify(r.bestProject, null, 2));
				const render = png(r.renderPng);
				writePng(join(out, `${name}.png`), render);
				const sheetScale = Math.max(1, Math.min(4, Math.floor(256 / Math.max(img.width, img.height))));
				writePng(
					join(out, `${name}.sheet.png`),
					gridSheet([[png(r.targetPng), render, png(r.diffPng)]], { scale: sheetScale })
				);
				const { bestProject: _p, renderPng: _r, targetPng: _t, diffPng: _d, ...rest } = r;
				writeFileSync(join(out, `${name}.result.json`), JSON.stringify(rest, null, 1));
				index.set(name, {
					name,
					source: file,
					width: img.width,
					height: img.height,
					template: r.template,
					loss: r.loss,
					terms: r.terms,
					evaluations: r.evaluations,
					ms: r.ms
				});
				if (useMemory)
					memory.push({ name, analysis: r.analysis, template: r.template, loss: r.loss, project: r.bestProject });
				done++;
				const eta = (((Date.now() - t0) / done) * (files.length - done)) / 1000;
				console.log(
					`[${String(done).padStart(4)}/${files.length}] w${w} ${name.padEnd(16)} ${r.template.padEnd(10)} loss ${r.loss.toFixed(3)}  ` +
						`(${r.ranking
							.slice(0, 3)
							.map((x) => `${x.template} ${x.loss.toFixed(3)}`)
							.join(', ')}) ${(r.ms / 1000).toFixed(1)}s ${r.stop}  eta ${(eta / 60).toFixed(1)}m${note}`
				);
				if (done % 10 === 0) saveIndex();
			} catch (e) {
				console.error(`FAIL ${name}: ${e instanceof Error ? e.message : e}`);
			}
		}
	};
	try {
		await Promise.all(Array.from({ length: workers }, (_, w) => work(w)));
	} finally {
		saveIndex();
		await s.close();
	}
	const entries = [...index.values()];
	console.log(
		`done ${entries.length} · mean loss ${(entries.reduce((a, e) => a + e.loss, 0) / Math.max(1, entries.length)).toFixed(3)} · ${((Date.now() - t0) / 60000).toFixed(1)} min`
	);
	console.log(`gallery → ${join(out, 'gallery.html')}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
