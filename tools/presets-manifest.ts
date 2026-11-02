// Write public/presets/manifest.json: the header of every preset file in public/presets/
// (docs/features/fr5.4-presets.md), served beside the app and deployed with it — its path, kind, target, name,
// description, category and preview — so the app lists them all from one small file and fetches a preset's project only
// when it is used. A preview comes from an image beside the preset (<name>.webp, .png or .jpg) when there is one, else
// from the preset's own `preview`.
//
//   npm run presets:manifest
//
// `npm run build` runs it first, and tools/previews.ts after rendering; presets.test.ts fails while it is out of date.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PresetManifest, PresetManifestEntry } from '../src/presets/manifest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PRESET_DIR = join(ROOT, 'public', 'presets');
export const MANIFEST_FILE = join(PRESET_DIR, 'manifest.json');

const IMAGE_TYPES: Record<string, string> = {
	'.webp': 'image/webp',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg'
};

/** Every preset file, as its path under public/presets/ without `.json` ("project/bricks", "layer/bricks/red-brick"). */
export function presetFiles(dir = PRESET_DIR): string[] {
	const out: string[] = [];
	const walk = (d: string) => {
		for (const name of readdirSync(d).sort()) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p);
			else if (name.endsWith('.json') && p !== MANIFEST_FILE)
				out.push(relative(PRESET_DIR, p).replace(/\\/g, '/').slice(0, -5));
		}
	};
	walk(dir);
	return out;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** The preview of preset `path`: an image file beside it, as a data URL, or the one stored in the file. */
function previewOf(path: string, stored: unknown): string | undefined {
	for (const [ext, mime] of Object.entries(IMAGE_TYPES)) {
		const file = join(PRESET_DIR, path + ext);
		if (existsSync(file)) return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
	}
	return str(stored);
}

export function buildManifest(): PresetManifest {
	const presets = presetFiles().flatMap((path): PresetManifestEntry[] => {
		const raw = JSON.parse(readFileSync(join(PRESET_DIR, `${path}.json`), 'utf8')) as Record<string, any>;
		const kind = str(raw.preset?.kind);
		if (!kind) return [];
		const e: PresetManifestEntry = { path, kind: kind as PresetManifestEntry['kind'], name: str(raw.name) ?? path };
		const target = str(raw.preset?.target);
		const description = str(raw.description);
		const category = str(raw.preset?.category);
		const preview = previewOf(path, raw.preview);
		if (target) e.target = target;
		if (description) e.description = description;
		if (category) e.category = category;
		if (preview) e.preview = preview;
		return [e];
	});
	return { version: 1, presets };
}

/** The manifest's text as written (one preset per line). */
export function manifestText(m = buildManifest()): string {
	return `{\n\t"version": ${m.version},\n\t"presets": [\n${m.presets.map((e) => `\t\t${JSON.stringify(e)}`).join(',\n')}\n\t]\n}\n`;
}

export function writeManifest(): number {
	const m = buildManifest();
	writeFileSync(MANIFEST_FILE, manifestText(m));
	return m.presets.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(`wrote public/presets/manifest.json (${writeManifest()} presets)`);
}
