// public/presets/manifest.json (docs/features/fr5.4-presets.md), written by `npm run presets:manifest`: every built-in
// preset's header and preview, so the menus list them at once; each preset's project is its own file, fetched when
// used.

import type { PresetKind } from '@/core/project';

export interface PresetManifestEntry {
	/** Its file under public/presets/, without `.json` ("project/retro/bricks"). */
	path: string;
	kind: PresetKind;
	target?: string;
	name: string;
	description?: string;
	category?: string;
	preview?: string;
	/** A lighting preset's sky images, by file name: projects name them without carrying them (setImageResolver). */
	images?: string[];
}

export interface PresetManifest {
	version: 1;
	presets: PresetManifestEntry[];
}
