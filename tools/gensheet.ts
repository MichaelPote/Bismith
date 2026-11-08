// Variant sheet of one generator: renders a spec's variants (seeds, settings) and lays them out for review.
//
//   npx tsx tools/gensheet.ts <spec.json> [--out DIR] [--samples N] [--backend windows|swiftshader]
//
// spec.json:
//   {
//     "type": "bricks",                    the generator under review (the "subject" layer)
//     "name": "bricks",                    output name (default: the type)
//     "size": 512,                         texture size (default 512)
//     "params": { … },                     subject params for every variant (over the editor's fresh layer, with
//                                          Diffuse and Height on so shape and relief both show)
//     "below": [{ "type": "wood", "params": { … } }],   layers under the subject (context, e.g. for Chips)
//     "above": [ … ],                      layers over it
//     "project": { … },                    project overrides (heightDepth, base, lighting, tileable…)
//     "variants": [{ "label": "default" }, { "label": "seed 7", "params": { "seed": 7 } }, …]
//                                          a variant may also set "project" (its width / height size the fresh
//                                          defaults too) and its own "below" / "above" (replacing the spec's)
//   }
//
// Writes <out>/<name>.png (top row: final renders; bottom row: height maps; one column per variant, left to right),
// <out>/<name>/<i>.png and <i>.height.png at full size, and <out>/<name>.md: each column's label and the subject
// params it sets, then the generator's own params with their defaults and ranges.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { openSession, type BackendKind } from './backend';
import { decodePng, writePng, type Rgba8 } from './png';
import { createLayer, createProject } from '../src/core/serialize';
import { freshParams, getLayerDef, layerParamDefs } from '../src/layers/registry';
import { ensureBuiltins } from '../src/render/builtins';
import type { ParamValues } from '../src/core/params';

interface LayerSpec {
	type: string;
	params?: ParamValues;
}
interface Spec {
	type: string;
	name?: string;
	size?: number;
	params?: ParamValues;
	below?: LayerSpec[];
	above?: LayerSpec[];
	project?: Record<string, unknown>;
	variants: {
		label: string;
		params?: ParamValues;
		project?: Record<string, unknown>;
		below?: LayerSpec[];
		above?: LayerSpec[];
	}[];
}

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => {
	const i = args.indexOf(`--${n}`);
	return i >= 0 ? args[i + 1] : d;
};
const specFile = resolve(args[0] ?? '');
const spec: Spec = JSON.parse(readFileSync(specFile, 'utf8'));
const name = spec.name ?? spec.type ?? basename(specFile, '.json');
const out = resolve(flag('out', 'harness-out/gensheet')!);
const samples = Number(flag('samples', '64'));
const size = spec.size ?? 512;

function layer(l: LayerSpec, tex: { width: number; height: number }, extra: ParamValues = {}) {
	return createLayer(l.type, { ...freshParams(l.type, tex), ...(l.params ?? {}), ...extra });
}

/** A variant's project: its own size (project.width / height) sets the fresh defaults; its below / above replace the spec's. */
function project(v: Spec['variants'][number]) {
	const num = (k: 'width' | 'height') => Number(v.project?.[k] ?? spec.project?.[k] ?? size);
	const tex = { width: num('width'), height: num('height') };
	const subject = layer({ type: spec.type }, tex, {
		dif_on: true,
		h_on: true,
		h_amount: 1,
		...(spec.params ?? {}),
		...(v.params ?? {})
	});
	return createProject({
		name: `${name} · ${v.label}`,
		width: tex.width,
		height: tex.height,
		layers: [
			...(v.below ?? spec.below ?? []).map((l) => layer(l, tex)),
			subject,
			...(v.above ?? spec.above ?? []).map((l) => layer(l, tex))
		],
		...(spec.project ?? {}),
		...(v.project ?? {})
	} as Parameters<typeof createProject>[0]);
}

function grid(rows: Rgba8[][], gap = 8): Rgba8 {
	const cw = Math.max(...rows.flat().map((im) => im.width));
	const ch = Math.max(...rows.flat().map((im) => im.height));
	const cols = Math.max(...rows.map((r) => r.length));
	const W = cols * (cw + gap) + gap;
	const H = rows.length * (ch + gap) + gap;
	const data = new Uint8Array(W * H * 4);
	for (let i = 0; i < W * H; i++) data.set([30, 33, 36, 255], i * 4);
	rows.forEach((row, r) =>
		row.forEach((im, c) => {
			for (let y = 0; y < im.height; y++)
				for (let x = 0; x < im.width; x++) {
					const si = (y * im.width + x) * 4;
					const di = ((gap + r * (ch + gap) + y) * W + gap + c * (cw + gap) + x) * 4;
					data.set([im.data[si], im.data[si + 1], im.data[si + 2], 255], di);
				}
		})
	);
	return { width: W, height: H, data };
}

/** Shared params listed in the settings (the shape and channel controls a reviewer should know exist). */
const SHARED_SHOWN = [
	'mk_target',
	'mk_op',
	'bevel',
	'profile',
	'bevel_aspect_on',
	'bevel_aspect',
	'aa',
	'sh_invert',
	'sh_lo',
	'sh_hi',
	'sh_gamma',
	'dif_jitter',
	'h_amount',
	'h_var',
	'h_mode',
	'lim_1',
	'lim_out',
	'warp_amount',
	'dw_amount',
	'dw_scale'
];

const png = (url: string) => decodePng(Buffer.from(url.split(',')[1], 'base64'));
const fmt = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : JSON.stringify(v));

async function main() {
	ensureBuiltins();
	if (!getLayerDef(spec.type)) throw new Error(`unknown layer type ${spec.type}`);
	mkdirSync(join(out, name), { recursive: true });
	const s = await openSession({ backend: flag('backend') as BackendKind | undefined, workers: 1 });
	const finals: Rgba8[] = [];
	const heights: Rgba8[] = [];
	const errors: string[] = [];
	try {
		for (const [i, v] of spec.variants.entries()) {
			await s.call('loadProject', project(v));
			const r = await s.call<{ png: string; errors: Record<string, string> }>('render', { samples });
			for (const [k, e] of Object.entries(r.errors ?? {})) errors.push(`${v.label}: ${k}: ${e}`);
			const maps = await s.call<Record<string, string>>('renderMaps', ['height']);
			const f = png(r.png);
			const h = png(maps.height);
			writePng(join(out, name, `${i + 1}.png`), f);
			writePng(join(out, name, `${i + 1}.height.png`), h);
			finals.push(f);
			heights.push(h);
		}
	} finally {
		await s.close();
	}
	writePng(join(out, `${name}.png`), grid([finals, heights]));

	// Settings: per column, the subject params set by the spec (over the fresh layer); then the generator's own params.
	const def = getLayerDef(spec.type)!;
	const lines = [
		`# ${def.label} (\`${spec.type}\`) — ${size}×${size}, ${samples} spp`,
		'',
		'Sheet: top row final renders, bottom row height maps; columns left to right:',
		''
	];
	spec.variants.forEach((v, i) => {
		const set = { ...(spec.params ?? {}), ...(v.params ?? {}) };
		const shown = Object.entries(set)
			.map(([k, val]) => `${k}=${fmt(val)}`)
			.join(', ');
		const ctx =
			v.below || v.above
				? ` — context below ${JSON.stringify(v.below ?? spec.below ?? [])}, above ${JSON.stringify(v.above ?? spec.above ?? [])}`
				: '';
		lines.push(
			`${i + 1}. **${v.label}**${shown ? ` — ${shown}` : ''}${v.project ? ` — project ${JSON.stringify(v.project)}` : ''}${ctx}  (\`${name}/${i + 1}.png\`)`
		);
	});
	if (spec.below?.length || spec.above?.length)
		lines.push(
			'',
			`Context layers: below ${JSON.stringify(spec.below ?? [])}, above ${JSON.stringify(spec.above ?? [])}`
		);
	if (errors.length) lines.push('', '**Render errors:**', ...errors.map((e) => `- ${e}`));
	const own = new Set(def.params.map((p) => p.key));
	// "default" is the plain default (layers built in code, keys missing from old files); a layer added in the editor
	// starts from its fresh values instead, and column 1 is that plus the spec's own params.
	const first = project(spec.variants[0]).layers[(spec.variants[0].below ?? spec.below ?? []).length].params;
	const fresh = createLayer(spec.type, freshParams(spec.type, { width: size, height: size })).params;
	const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
	lines.push(
		'',
		`## ${def.label} params (plain default, new-layer value and column 1 value where they differ · range · slider range)`,
		''
	);
	for (const d of layerParamDefs(spec.type).filter((p) => own.has(p.key))) {
		const soft =
			d.softMin !== undefined || d.softMax !== undefined ? ` (slider ${d.softMin ?? d.min}…${d.softMax ?? d.max})` : '';
		const range =
			d.type === 'enum'
				? (d.options ?? []).map((o) => o.value).join(' | ')
				: d.min !== undefined
					? `${d.min}…${d.max}${soft}${d.unit ? ` ${d.unit}` : ''}`
					: '';
		const vals = `default ${fmt(d.default)}${same(fresh[d.key], d.default) ? '' : `, new layer ${fmt(fresh[d.key])}`}${same(first[d.key], fresh[d.key]) ? '' : `, column 1 ${fmt(first[d.key])}`}`;
		lines.push(
			`- \`${d.key}\` ${d.label} — ${d.type}, ${vals}${range ? ` · ${range}` : ''}${d.hint ? ` — ${d.hint}` : ''}`
		);
	}
	// The shared controls every layer of this kind also has (Edge, Shape mask, the channel cards), as column 1 has them.
	const shared = layerParamDefs(spec.type).filter((d) => !own.has(d.key) && SHARED_SHOWN.includes(d.key));
	if (shared.length) {
		lines.push('', '## Shared controls of every such layer (values in column 1)', '');
		for (const d of shared) {
			const range =
				d.type === 'enum'
					? (d.options ?? []).map((o) => o.value).join(' | ')
					: d.min !== undefined
						? `${d.min}…${d.max}${d.unit ? ` ${d.unit}` : ''}`
						: '';
			lines.push(
				`- \`${d.key}\` ${d.label} = ${fmt(first[d.key])}${range ? ` · ${range}` : ''}${d.hint ? ` — ${d.hint}` : ''}`
			);
		}
	}
	writeFileSync(join(out, `${name}.md`), lines.join('\n') + '\n');
	console.log(
		`${name}: ${spec.variants.length} variants → ${join(out, `${name}.png`)}${errors.length ? ` (${errors.length} render errors)` : ''}`
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
