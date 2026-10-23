// What makes a project's repeat obvious, and which layer is to blame (docs/features/fr9-tiling-workspace.md): the
// tiling analysis and leave-one-out attribution, headless.
//
//   npx tsx tools/tiling.ts <project.json…> [--presets [id1,id2]] [--out DIR] [--samples 32] [--top 3]
//                           [--backend windows|swiftshader] [--workers N] [--json]
//                           [--fix [--seeds 24] [--culprits 2] [--scale]]
//
// Per project it prints the tiling score and terms (patches, lines, clumping, tone; 0..1) and the ranked findings — which
// layer behind which term — and writes <out>/<name>.png: [render 3×3 | hotspots 3×3 | the top culprits'
// contributions 3×3] and <name>.render.png (one tile). --presets runs the built-in example projects (all, or the listed ids). --json prints one line
// of JSON per project instead of the table.
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
function tiled(img: Rgba8, n = 3): Rgba8 {
	const W = img.width * n;
	const H = img.height * n;
	const data = new Uint8Array(W * H * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++)
			data.set(
				img.data.subarray(
					((y % img.height) * img.width + (x % img.width)) * 4,
					((y % img.height) * img.width + (x % img.width)) * 4 + 4
				),
				(y * W + x) * 4
			);
	return { width: W, height: H, data };
}

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
				` adds ${l.contribution.toFixed(3)}; without it ${f2(l.without.score)}`
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
				evaluations: r.evaluations
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
	const s = await openSession({ backend, workers, logPage: false });
	console.error(`[tiling] ${s.backend}: ${s.renderer}`);
	try {
		let next = 0;
		await Promise.all(
			Array.from({ length: s.workers }, async (_, w) => {
				while (next < jobs.length) {
					const job = jobs[next++];
					await s.callOn(w, 'loadProject', job.project);
					if (fix) {
						const r = await s.callOn<HeadlessTilingFixResult>(w, 'tilingFix', {
							samples,
							seeds,
							culprits: culpritCount,
							scale
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
					const r = await s.callOn<HeadlessTilingResult>(w, 'tiling', { samples, maps: true });
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
	} finally {
		await s.close();
	}
	console.error(`[tiling] sheets → ${out}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
