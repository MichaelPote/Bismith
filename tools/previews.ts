// Render preset files (public/presets/**/*.json) and store a small preview in each, so the new-project wizard and the preset
// menus show them without compiling and rendering (docs/features/fr8.20-project-previews.md, fr5.4-presets.md).
//
//   npx tsx tools/previews.ts [--backend windows|swiftshader] [--samples 256] [--only path1,path2] [--missing]
//
// --only takes paths under public/presets/ without .json ("project/retro/bricks", "lighting/torch") or bare file names; --missing
// renders only the files without a preview. Run it after adding or changing a preset (or the renderer, if their look
// moved); presets.test.ts checks every preset has one. It also rewrites the manifest, which carries the previews.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { num, parseArgs, str } from './args';
import { openSession, type BackendKind } from './backend';
import { PRESET_DIR, selectPresets, writeManifest } from './presets-manifest';

const args = parseArgs(process.argv.slice(2), ['missing']);
const samples = num(args, 'samples', 256);
const only = str(args, 'only', '').split(',').filter(Boolean);
const missing = 'missing' in args.flags;

/** The file's project with `preview` set, keeping its key order (preview before the preset header, as saved). */
function withPreview(raw: Record<string, unknown>, preview: string): Record<string, unknown> {
	const { preview: _old, preset, ...rest } = raw;
	return { ...rest, preview, ...(preset ? { preset } : {}) };
}

async function main() {
	const wanted = selectPresets(only).filter(
		(k) =>
			!missing || !(JSON.parse(readFileSync(join(PRESET_DIR, `${k}.json`), 'utf8')) as { preview?: string }).preview
	);
	if (!wanted.length) {
		writeManifest();
		return console.log('[previews] nothing to render');
	}
	const s = await openSession({ backend: str(args, 'backend') as BackendKind | undefined, logPage: false });
	console.log(`[previews] ${s.backend}: ${s.renderer}`);
	try {
		for (const k of wanted) {
			const file = join(PRESET_DIR, `${k}.json`);
			const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
			await s.callOn(0, 'loadProject', { ...raw, preview: undefined });
			await s.callOn(0, 'settle');
			await s.callOn(0, 'render', { samples });
			const url = await s.callOn<string | undefined>(0, 'preview', { project: k.startsWith('project/') });
			if (!url) throw new Error(`${k}: no preview`);
			writeFileSync(file, JSON.stringify(withPreview(raw, url), null, 2) + '\n');
			console.log(`${k.padEnd(28)} ${(url.length / 1024).toFixed(1)} KB  ${url.slice(5, url.indexOf(';'))}`);
		}
	} finally {
		await s.close();
		writeManifest();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
