// Screenshot the editor UI (on the GPU when there is one, tools/editor.ts):
//   npx tsx tools/shot.ts [out.png] [--project file.json] [--w 1440] [--h 900] [--wait 2500] [--eval "js"]
//                         [--backend windows|swiftshader]

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BackendKind } from './backend';
import { openEditor } from './editor';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
	const args = process.argv.slice(2);
	const flag = (name: string, def: string) => {
		const i = args.indexOf(`--${name}`);
		return i >= 0 ? args[i + 1] : def;
	};
	const out = args[0] && !args[0].startsWith('--') ? args[0] : join(ROOT, 'harness-out/editor.png');
	const page = await openEditor({
		backend: flag('backend', 'auto') as BackendKind | 'auto',
		width: Number(flag('w', '1440')),
		height: Number(flag('h', '900'))
	});
	try {
		console.log(`${page.backend}: ${page.renderer}`);
		const project = flag('project', '');
		if (project) await page.openProject(readFileSync(project, 'utf8'));
		else {
			// A fresh browser is a first visit, which opens the New Project dialog: close it, the shot is of the editor.
			await page.waitFor(`!!document.querySelector('.wizard')`, 5000).catch(() => undefined);
			await page.key('Escape');
		}
		const js = flag('eval', '');
		if (js) await page.eval(js);
		await new Promise((r) => setTimeout(r, Number(flag('wait', '2500'))));
		await page.screenshot(out);
		console.log(`screenshot → ${out}`);
	} finally {
		await page.close();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
