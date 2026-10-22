// The built-in presets: the project files in presets/ (docs/features/fr5.4-presets.md), bundled through the generated
// builtin.ts. A preset is an ordinary project with a `preset` header saying what it applies to; the starters (kind
// project) are the new-project wizard's cards and double as optimiser seeds for reference matching.

import type { PresetKind, Project } from '@/core/project';
import { normalizeProject } from '@/core/serialize';
import { BUILTIN_FILES } from './builtin';

/** One preset in a menu: a built-in or one of the user's (stores/presets.ts), loaded on demand. */
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
	project: () => Project;
}

interface RawHeader {
	name?: unknown;
	description?: unknown;
	preview?: unknown;
	preset?: { kind?: unknown; target?: unknown; category?: unknown };
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

let builtins: PresetEntry[] | null = null;

/** Every built-in preset, in file order. Headers are read at once; projects are normalised when asked for. */
export function builtinPresets(): PresetEntry[] {
	builtins ??= Object.entries(BUILTIN_FILES).flatMap(([path, raw]): PresetEntry[] => {
		const h = raw as RawHeader;
		const kind = str(h.preset?.kind) as PresetKind | undefined;
		if (!kind) return [];
		let cached: Project | null = null;
		return [
			{
				key: `builtin:${path}`,
				builtin: true,
				kind,
				target: str(h.preset?.target),
				name: str(h.name) ?? path,
				description: str(h.description),
				category: str(h.preset?.category),
				preview: str(h.preview),
				project: () => structuredClone((cached ??= normalizeProject(raw)))
			}
		];
	});
	return builtins;
}

/** A preset's project to open as a project of its own: without the preset header, which stays with its file. */
export function asProject(p: Project): Project {
	delete p.preset;
	return p;
}

/** A built-in starter's project by its file name (presets/project/<id>.json), to open. */
export function builtinProject(id: string): Project | undefined {
	const e = builtinPresets().find((p) => p.key === `builtin:project/${id}`);
	return e && asProject(e.project());
}

/** The starters as the tools know them: id (file name), name, group (category) and a builder. */
export interface Preset {
	id: string;
	name: string;
	group: string;
	build: () => Project;
}

export const PRESETS: Preset[] = builtinPresets()
	.filter((p) => p.kind === 'project')
	.map((p) => ({
		id: p.key.slice('builtin:project/'.length),
		name: p.name,
		group: p.category ?? 'Other',
		build: () => asProject(p.project())
	}));
