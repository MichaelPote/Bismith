// A preset's thumbnail, rendered off-screen (docs/features/fr5.4-presets.md): the viewport is suspended, the preset
// project rendered and captured, and the user's project put back — nothing in it changes and no undo step is added.

import type { Project } from '@/core/project';
import type { Engine } from '@/render/engine';
import { shaderKey } from '@/render/materialPipeline';
import { capturePreview } from '@/render/preview';

/** Samples of a thumbnail: enough for soft shadows at 128 px, quick enough to render while a dialog is open. */
export const THUMBNAIL_SAMPLES = 64;

export async function renderThumbnail(engine: Engine, preset: Project, restore: Project): Promise<string | undefined> {
	engine.suspend();
	try {
		engine.setProject(preset);
		await engine.precompile(preset.layers.map(shaderKey));
		engine.renderNow(THUMBNAIL_SAMPLES);
		return capturePreview(engine);
	} finally {
		engine.resume(restore);
	}
}
