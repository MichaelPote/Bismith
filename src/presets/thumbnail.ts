// A preset's thumbnail, rendered off-screen (docs/features/fr5.4-presets.md): the viewport is suspended, the preset
// project rendered and captured, and the user's project put back — nothing in it changes and no undo step is added.

import type { Project } from '@/core/project';
import type { Engine } from '@/render/engine';
import { shaderKey } from '@/render/materialPipeline';
import { capturePreview, renderPreview, TILE_PREVIEW, type PreviewSize } from '@/render/preview';

/** Samples of a thumbnail kept in memory only (renderThumbnails): enough for soft shadows at card size, and quick. */
export const THUMBNAIL_SAMPLES = 64;

/** A preset's stored thumbnail: rendered off-screen at PREVIEW_SAMPLES, the page responsive meanwhile. */
export function renderThumbnail(
	engine: Engine,
	preset: Project,
	size: PreviewSize = TILE_PREVIEW
): Promise<string | undefined> {
	return renderPreview(engine, size, preset);
}

/**
 * In-memory thumbnails of several projects (the variant cards) in one pass, at THUMBNAIL_SAMPLES (the viewport resumes
 * once, with `restore`); `capture` takes each from the engine once it has rendered (by default a preview of `size`).
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
