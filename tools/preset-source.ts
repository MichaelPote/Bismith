// The built-in presets read from the repo's public/presets/ folder, for tools running outside a page:
// setPresetSource(fsPresetSource()) before loading them (src/presets fetches them beside the page otherwise).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PresetSource } from '../src/presets';
import { PRESET_DIR } from './presets-manifest';

export function fsPresetSource(): PresetSource {
	const read = async (p: string) => JSON.parse(await readFile(join(PRESET_DIR, p), 'utf8')) as unknown;
	return { manifest: () => read('manifest.json'), file: (p) => read(`${p}.json`) };
}
