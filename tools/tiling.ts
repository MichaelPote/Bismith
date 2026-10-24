// What makes a project's repeat obvious, and which layer is to blame (docs/features/fr9-tiling-workspace.md): the
// tiling analysis and leave-one-out attribution, headless.
//
//   npx tsx tools/tiling.ts <project.json…> [--presets [id1,id2]] [--out DIR] [--samples 32] [--top 3]
//                           [--backend windows|swiftshader] [--workers N] [--json]
//                           [--fix [--seeds 24] [--culprits 2] [--scale]] [--without] [--cpu] [--check]
//
// Per project it prints the tiling score and terms (patches, lines, clumping, tone; 0..1) and the ranked findings — which
// layer behind which term — and writes <out>/<name>.png: [render 3×3 | hotspots 3×3 | the top culprits'
// contributions 3×3] and <name>.render.png (one tile). --presets runs the built-in example projects (all, or the listed ids). --json prints one line
// of JSON per project instead of the table. --without also analyses each leave-one-out render (the "without it" score:
// a whole analysis per layer). --cpu analyses on the CPU (the reference implementation) instead of the GPU. --samples is
// per render up to 512 × 512 traced px; a larger canvas gets proportionally fewer, at least 8 (frameSamples in
// src/tiling/evaluate.ts), as in the workspace.
//
// --check compares the GPU analysis with the CPU reference on each project's render (kernels, score, terms) and times
// both; it exits with 1 when they disagree.
//
// --fix reseeds and nudges the blamed layers instead (tiling score down, look held — src/tiling/fix.ts): it prints the
// score and drift before and after and the changes, and writes <out>/<name>.fix.png [before 3×3 | after 3×3 | hotspots
// before | after] and the fixed project as <name>.fixed.json. --scale lets it change sizes too (off: a fix keeps the
// material's scale).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { openSession, type BackendKind } from './backend';
import { contactSheet, decodePng, writePng, type Rgba8 } from './png';
import { PRESETS } from '../src/presets';
import { tileImage } from '../src/match/image';
import type { HeadlessTilingFixResult, HeadlessTilingResult } from '../src/headless';

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => {
	const i = args.indexOf(`--${n}`);
	if (i < 0) return d;
	const v = args[i + 1];
	args.splice(i, v === undefined || v.startsWith('--') ? 1 : 2);
	return v === undefined || v.startsWith('--') ? '' : v;
};
const has = (n: string) => {
	const i = args.indexOf(`--${n}`);
	if (i >= 0) args.splice(i, 1);
	return i >= 0;
};
const out = resolve(flag('out', 'harness-out/tiling')!);
const samples = Number(flag('samples', '32'));
const top = Number(flag('top', '3'));
const workers = Number(flag('workers', '1'));
const backend = flag('backend') as BackendKind | undefined;
const presets = flag('presets');
const asJson = has('json');
const fix = has('fix');
const seeds = Number(flag('seeds', '24'));
const culpritCount = Number(flag('culprits', '2'));
const scale = has('scale');
const withoutIt = has('without');
const cpu = has('cpu');
const check = has('check');

interface Job {
	name: string;
	project: unknown;
}

const jobs: Job[] = args.map((f) => ({
	name: basename(f).replace(/(\.bismith)?(\(\d+\))?\.json$/, ''),
	project: JSON.parse(readFileSync(f, 'utf8'))
}));
if (presets !== undefined) {
	const ids = presets.split(',').filter(Boolean);
	for (const p of PRESETS)
		if (!ids.length || ids.includes(p.id)) jobs.push({ name: p.id, project: { ...p.build(), preview: undefined } });
}
if (!jobs.length) {
	console.error('usage: npx tsx tools/tiling.ts <project.json…> [--presets [ids]] [--out DIR] [--samples N]');
	process.exit(1);
}

const png = (url: string): Rgba8 => decodePng(Buffer.from(url.split(',')[1], 'base64'));

/** The image repeated n × n. */
const tiled = (img: Rgba8, n = 3): Rgba8 => ({
	width: img.width * n,
	height: img.height * n,
	data: tileImage(img.data, img.width, img.height, n)
});

const f2 = (v: number) => v.toFixed(2);

function report(name: string, r: HeadlessTilingResult): void {
	if (asJson) {
		const { renderPng: _a, hotspotPng: _b, ...rest } = r;
		console.log(JSON.stringify({ name, ...rest, layers: rest.layers.map(({ mapPng: _c, ...l }) => l) }));
		return;
	}
	console.log(
		`\n${name}  score ${f2(r.score)}  ${Object.entries(r.terms)
			.map(([t, v]) => `${t} ${f2(v)}`)
			.join('  ')}` + `  (${r.renders} renders, ${(r.ms / 1000).toFixed(1)} s)`
	);
	if (!r.findings.length) console.log('  no culprit stands out');
	for (const f of r.findings.slice(0, 6)) {
		const l = r.layers[f.layer];
		const where = l.material ? ` [${l.material}]` : '';
		console.log(
			`  ${f.term.padEnd(8)} ${f2(f.weight)}  ${l.name}${where} (${l.type})  blame ${l.blame[f.term].toFixed(3)} ΔE,` +
				` adds ${l.contribution.toFixed(3)}` +
				(l.without ? `; without it ${f2(l.without.score)}` : '')
		);
	}
}

function reportFix(name: string, r: HeadlessTilingFixResult): void {
	if (asJson) {
		console.log(
			JSON.stringify({
				name,
				before: r.before,
				after: r.after,
				changes: r.changes,
				trials: r.trials,
				evaluations: r.evaluations,
				driftFree: r.driftFree,
				ms: Math.round(r.ms)
			})
		);
		return;
	}
	const terms = (t: Record<string, number>) =>
		Object.entries(t)
			.map(([k, v]) => `${k} ${f2(v)}`)
			.join(' ');
	console.log(
		`\n${name}  score ${f2(r.before.score)} → ${f2(r.after.score)}  drift ${f2(r.after.drift)}` +
			`  (${r.evaluations} evaluations, ${(r.ms / 1000).toFixed(0)} s)`
	);
	console.log(`  before: ${terms(r.before.terms)}\n  after:  ${terms(r.after.terms)}`);
	const culprits = [...new Set(r.findings.map((f) => f.name))].slice(0, culpritCount);
	console.log(`  culprits: ${culprits.join(', ') || 'none'}`);
	const seedTrials = r.trials.filter((t) => t.key === 'seed');
	if (seedTrials.length) {
		const sc = seedTrials.map((t) => t.score).sort((a, b) => a - b);
		const dr = seedTrials.map((t) => t.drift).sort((a, b) => a - b);
		console.log(
			`  reseeds: score ${f2(sc[0])}…${f2(sc[sc.length >> 1])}…${f2(sc[sc.length - 1])} (min…median…max),` +
				` drift ${f2(dr[0])}…${f2(dr[dr.length >> 1])}…${f2(dr[dr.length - 1])}; drift allowed ${f2(r.driftFree)}`
		);
	}
	if (!r.changes.length) console.log('  no change helped');
	for (const c of r.changes) console.log(`  ${c.name}: ${c.key} ${String(c.from)} → ${String(c.to)}`);
}

async function main() {
	mkdirSync(out, { recursive: true });
	const s = await openSession({ backend, workers, logPage: check });
	console.error(`[tiling] ${s.backend}: ${s.renderer}`);
	try {
		let next = 0;
		let failed = 0;
		await Promise.all(
			Array.from({ length: s.workers }, async (_, w) => {
				while (next < jobs.length) {
					const job = jobs[next++];
					await s.callOn(w, 'loadProject', job.project);
					if (check) {
						const r = await s.callOn<HeadlessTilingResult>(w, 'tiling', {
							samples,
							analysisOnly: true,
							checkGpu: true
						});
						const c = r.gpuCheck;
						const bad =
							!c ||
							!(Math.abs(c.score.gpu - c.score.cpu) < 0.002) ||
							Object.values(c.kernels).some((k) => !(k.max < 0.02));
						if (bad) failed++;
						console.log(
							`${job.name.padEnd(10)} ${bad ? 'DIFFERS' : 'ok     '}` +
								(c
									? `  score ${c.score.gpu.toFixed(4)} gpu / ${c.score.cpu.toFixed(4)} cpu  ` +
										Object.entries(c.kernels)
											.map(([k, v]) => `${k} ${v.max.toExponential(1)}${v.over ? ` (${v.over} px)` : ''}`)
											.join('  ') +
										`  analysis ${c.gpuMs.toFixed(1)} ms gpu, ${c.cpuMs.toFixed(0)} ms cpu`
									: '  no GPU analysis')
						);
						continue;
					}
					if (fix) {
						const r = await s.callOn<HeadlessTilingFixResult>(w, 'tilingFix', {
							samples,
							seeds,
							culprits: culpritCount,
							scale,
							cpu
						});
						reportFix(job.name, r);
						const sheet = contactSheet(
							[r.beforePng, r.afterPng, r.hotspotBeforePng, r.hotspotAfterPng].map((u) => tiled(png(u))),
							1
						);
						writePng(join(out, `${job.name}.fix.png`), sheet);
						writeFileSync(join(out, `${job.name}.fixed.json`), JSON.stringify(r.project, null, '\t'));
						continue;
					}
					const r = await s.callOn<HeadlessTilingResult>(w, 'tiling', {
						samples,
						maps: top,
						without: withoutIt,
						cpu
					});
					report(job.name, r);
					const culprits = [...new Set(r.findings.map((f) => f.layer))].slice(0, top);
					const sheet = contactSheet(
						[
							png(r.renderPng),
							png(r.hotspotPng),
							...culprits
								.map((i) => r.layers[i].mapPng)
								.filter((u): u is string => !!u)
								.map(png)
						].map((im) => tiled(im)),
						1
					);
					writePng(join(out, `${job.name}.png`), sheet);
					writePng(join(out, `${job.name}.render.png`), png(r.renderPng));
					writeFileSync(
						join(out, `${job.name}.json`),
						JSON.stringify(
							{
								...r,
								renderPng: undefined,
								hotspotPng: undefined,
								layers: r.layers.map((l) => ({ ...l, mapPng: undefined }))
							},
							null,
							'\t'
						)
					);
				}
			})
		);
		if (failed) process.exitCode = 1;
	} finally {
		await s.close();
	}
	console.error(check ? '[tiling] GPU check done' : `[tiling] sheets → ${out}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
