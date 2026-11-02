// The built-in presets: the project files in public/presets/ (docs/features/fr5.4-presets.md), deployed beside the app,
// listed by their manifest.json (`npm run presets:manifest`) and fetched one by one when used — the app bundles none. A preset is an ordinary project with a `preset` header saying what it applies to; the starters (kind project)
// are the new-project wizard's cards and double as optimiser seeds for reference matching.

import type { PresetKind, Project } from '@/core/project';
import { normalizeProject } from '@/core/serialize';
import { putImage } from '@/core/images';
import type { PresetManifest } from './manifest';

/** One preset in a menu: a built-in or one of the user's (stores/presets.ts), its project loaded when asked for. */
export interface PresetEntry {
	/** `builtin:<path under presets/>` or `user:<id>`. */
	key: string;
	builtin: boolean;
	kind: PresetKind;
	target?: string;
	name: string;
	description?: string;
	/** Menu group; none = Other. */
	category?: string;
	preview?: string;
	/** A fresh copy of the preset's project. */
	project: () => Promise<Project>;
}

/** Where the built-ins come from: presets/ beside the page in the browser; tools and tests set their own. */
export interface PresetSource {
	/** presets/manifest.json, parsed. */
	manifest: () => Promise<unknown>;
	/** presets/<path>.json, parsed. */
	file: (path: string) => Promise<unknown>;
}

/** Checked with the server every time (a cheap 304 when unchanged), so a deploy's presets show at once. */
async function fetchJson(url: string): Promise<unknown> {
	const r = await fetch(url, { cache: 'no-cache' });
	if (!r.ok) throw new Error(`${url}: ${r.status}`);
	return r.json();
}

/** presets/ beside the page (the built app works from any folder: vite `base: './'`). */
function defaultSource(): PresetSource {
	const at = (p: string) => {
		if (typeof document === 'undefined') throw new Error('No page to fetch presets from: setPresetSource() first');
		return new URL(`presets/${p}`, document.baseURI).href;
	};
	return { manifest: () => fetchJson(at('manifest.json')), file: (p) => fetchJson(at(`${p}.json`)) };
}

let source: PresetSource = defaultSource();
let loading: Promise<PresetEntry[]> | null = null;

/** Load the built-ins from elsewhere (and forget those loaded). */
export function setPresetSource(s: PresetSource): void {
	source = s;
	loading = null;
}

/** Every built-in preset, in the manifest's order (once; menus call it as they open). */
export function loadBuiltinPresets(): Promise<PresetEntry[]> {
	loading ??= source.manifest().then((raw) =>
		(raw as PresetManifest).presets.map((m): PresetEntry => {
			let cached: Promise<Project> | null = null;
			return {
				key: `builtin:${m.path}`,
				builtin: true,
				kind: m.kind,
				target: m.target,
				name: m.name,
				description: m.description,
				category: m.category,
				preview: m.preview,
				project: async () => {
					cached ??= source.file(m.path).then((p) => normalizeProject(p));
					cached.catch(() => (cached = null)); // a failed fetch is tried again next time
					return structuredClone(await cached);
				}
			};
		})
	);
	loading.catch(() => (loading = null));
	return loading;
}

/**
 * A preset's project to open as a project of its own: the images it carries stored in this browser first, then without
 * the preset header, which stays with its file.
 */
export function asProject(p: Project): Project {
	for (const [name, url] of Object.entries(p.preset?.images ?? {})) putImage(name, url);
	delete p.preset;
	return p;
}

/** The starter the app opens with on a first visit, and stages preset thumbnails on. */
export const STARTER = 'bricks';

/** A built-in starter's project by its file name (presets/project/<id>.json), to open. */
export async function builtinProject(id: string): Promise<Project | undefined> {
	const e = (await loadBuiltinPresets()).find((p) => p.key === `builtin:project/${id}`);
	return e && asProject(await e.project());
}

/** The starters as the tools know them: id (file name), name, group (category) and a builder. */
export interface Preset {
	id: string;
	name: string;
	group: string;
	build: () => Promise<Project>;
}

export async function starterPresets(): Promise<Preset[]> {
	return (await loadBuiltinPresets())
		.filter((p) => p.kind === 'project')
		.map((p) => ({
			id: p.key.slice('builtin:project/'.length),
			name: p.name,
			group: p.category ?? 'Other',
			build: async () => asProject(await p.project())
		}));
}
