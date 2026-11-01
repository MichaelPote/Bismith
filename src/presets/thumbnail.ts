// A preset's thumbnail, rendered off-screen (docs/features/fr5.4-presets.md): the viewport is suspended, the preset
// project rendered and captured, and the user's project put back — nothing in it changes and no undo step is added.

import type { Project } from '@/core/project';
import type { Engine } from '@/render/engine';
import { shaderKey } from '@/render/materialPipeline';
import { capturePreview, type PreviewSize } from '@/render/preview';

/** Samples of a thumbnail: enough for soft shadows at 128 px, quick enough to render while a dialog is open. */
export const THUMBNAIL_SAMPLES = 64;

export async function renderThumbnail(engine: Engine, preset: Project, restore: Project): Promise<string | undefined> {
	return (await renderThumbnails(engine, [preset], restore))[0];
}

/**
 * Thumbnails of several projects in one pass (the viewport resumes once, with `restore`); `capture` takes each from the
 * engine once it has rendered (by default a preview of `size`).
 */
export async function renderThumbnails<T = string | undefined>(
	engine: Engine,
	projects: Project[],
	restore: Project,
	size?: PreviewSize,
	capture: (engine: Engine, project: Project) => T = (e) => capturePreview(e, size) as T
): Promise<T[]> {
	engine.suspend();
	const out: T[] = [];
	try {
		for (const p of projects) {
			engine.setProject(p);
			await engine.precompile(p.layers.map(shaderKey));
			engine.renderNow(THUMBNAIL_SAMPLES);
			out.push(capture(engine, p));
		}
		return out;
	} finally {
		engine.resume(restore);
	}
}
