// Screenshot the editor UI (on the GPU when there is one, tools/editor.ts):
//   npx tsx tools/shot.ts [out.png] [--project file.json] [--w 1440] [--h 900] [--wait 2500] [--eval "js"]
//                         [--backend windows|swiftshader]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { num, parseArgs, ROOT, str } from './args';
import type { BackendKind } from './backend';
import { openEditor } from './editor';

async function main() {
	const args = parseArgs();
	const out = args.positional[0] ?? join(ROOT, 'harness-out/editor.png');
	const page = await openEditor({
		backend: str(args, 'backend', 'auto') as BackendKind | 'auto',
		width: num(args, 'w', 1440),
		height: num(args, 'h', 900)
	});
	try {
		console.log(`${page.backend}: ${page.renderer}`);
		const project = str(args, 'project', '');
		if (project) await page.openProject(readFileSync(project, 'utf8'));
		else {
			// A fresh browser is a first visit, which opens the New Project dialog: close it, the shot is of the editor.
			await page.waitFor(`!!document.querySelector('.wizard')`, 5000).catch(() => undefined);
			await page.key('Escape');
		}
		const js = str(args, 'eval', '');
		if (js) await page.eval(js);
		await new Promise((r) => setTimeout(r, num(args, 'wait', 2500)));
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
