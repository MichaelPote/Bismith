// Screenshot the editor UI: npx tsx tools/shot.ts [out.png] [--w 1440] [--h 900] [--wait 2500] [--eval "js"]

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function chromiumEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
	const lib = join(ROOT, '.cache/chromium-libs/usr/lib/x86_64-linux-gnu');
	if (existsSync(lib)) env.LD_LIBRARY_PATH = [lib, join(lib, 'nss'), env.LD_LIBRARY_PATH].filter(Boolean).join(':');
	return env;
}

async function main() {
	const args = process.argv.slice(2);
	const flag = (name: string, def: string) => {
		const i = args.indexOf(`--${name}`);
		return i >= 0 ? args[i + 1] : def;
	};
	const out = args[0] && !args[0].startsWith('--') ? args[0] : join(ROOT, 'harness-out/editor.png');
	const server = await createServer({
		root: ROOT,
		configFile: join(ROOT, 'vite.config.ts'),
		logLevel: 'error',
		server: { port: 5191, strictPort: false, host: '127.0.0.1' }
	});
	await server.listen();
	const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5191/';
	const browser = await chromium.launch({
		args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
		env: chromiumEnv()
	});
	try {
		const page = await browser.newPage({
			viewport: { width: Number(flag('w', '1440')), height: Number(flag('h', '900')) }
		});
		page.on('console', (m) =>
			m.type() === 'error' || m.type() === 'log' ? console.error(`[page ${m.type()}]`, m.text()) : undefined
		);
		page.on('pageerror', (e) => console.error('[page error]', e.message));
		await page.goto(url);
		await page.evaluate(() => localStorage.clear());
		await page.goto(url);
		const js = flag('eval', '');
		if (js) await page.evaluate(js);
		await page.waitForTimeout(Number(flag('wait', '2500')));
		await page.screenshot({ path: out });
		console.log(`screenshot → ${out}`);
	} finally {
		await browser.close();
		await server.close();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
