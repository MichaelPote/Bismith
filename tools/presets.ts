// Render every preset to harness-out/presets (or --out) and write a contact sheet.
//   npx tsx tools/presets.ts [--out dir] [--only id1,id2] [--samples N] [--scale 3]

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { contactSheet, decodePng, writePng, type Rgba8 } from './png';
import type {} from '../src/headless';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function chromiumEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
	const lib = join(ROOT, '.cache/chromium-libs/usr/lib/x86_64-linux-gnu');
	if (existsSync(lib)) env.LD_LIBRARY_PATH = [lib, join(lib, 'nss'), env.LD_LIBRARY_PATH].filter(Boolean).join(':');
	return env;
}

const flag = (name: string, def: string) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : def;
};

async function main() {
	const out = resolve(flag('out', join(ROOT, 'harness-out/presets')));
	const only = flag('only', '').split(',').filter(Boolean);
	const samples = flag('samples', '');
	const scale = Number(flag('scale', '3'));
	mkdirSync(out, { recursive: true });
	const server = await createServer({
		root: ROOT,
		configFile: join(ROOT, 'vite.config.ts'),
		logLevel: 'error',
		server: { port: 5193, strictPort: false, host: '127.0.0.1' }
	});
	await server.listen();
	const { PRESETS } = await server.ssrLoadModule('/src/presets/index.ts');
	const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5193/';
	const browser = await chromium.launch({
		args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
		env: chromiumEnv()
	});
	const page = await browser.newPage();
	page.on('console', (m) =>
		m.type() === 'error' && !/GPU stall/.test(m.text()) ? console.error('[page]', m.text()) : undefined
	);
	await page.goto(url + '?headless');
	await page.waitForFunction(() => window.__bismith?.ready === true, null, { timeout: 60_000 });
	const imgs: Rgba8[] = [];
	for (const preset of PRESETS as { id: string; build: () => object }[]) {
		if (only.length && !only.includes(preset.id)) continue;
		const project = preset.build();
		writeFileSync(join(out, `${preset.id}.json`), JSON.stringify(project, null, 2));
		const r = await page.evaluate(
			({ project, samples }) => {
				const a = window.__bismith!;
				a.loadProject(project);
				return a.render(samples ? { samples: Number(samples) } : {});
			},
			{ project, samples }
		);
		const img = decodePng(Buffer.from(r.png.split(',')[1], 'base64'));
		writePng(join(out, `${preset.id}.png`), img);
		imgs.push(img);
		const errs = Object.values(r.errors);
		console.log(
			`${preset.id.padEnd(10)} ${r.width}×${r.height} ${r.samples} spp ${r.ms.toFixed(0)} ms${errs.length ? '  ERR ' + errs[0].slice(0, 200) : ''}`
		);
	}
	if (imgs.length) {
		writePng(join(out, 'sheet.png'), contactSheet(imgs, scale));
		console.log(`sheet → ${join(out, 'sheet.png')}`);
	}
	await browser.close();
	await server.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
