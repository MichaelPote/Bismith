// Variant thumbnails (FR10): the shown variant's captured from the viewport once its render has THUMBNAIL_SAMPLES and
// again when it has settled, the others
// from an image the engine already has (Engine.bestFinal: a recent export, the viewport before switching) or else
// rendered off-screen (presets/thumbnail.ts) while the viewport is idle — all those in one pass, so the viewport
// restarts once. Each is a preview of the whole texture (the workspace's cards) and a crop of its middle at 50% zoom
// (the Variants panel's rows). Kept in memory by a hash of each variant's project; nothing is saved with it.

import { reactive, toRaw, watch } from 'vue';
import { hashText } from '@/core/hash';
import * as V from '@/core/variants';
import type { Project } from '@/core/project';
import { renderThumbnails, THUMBNAIL_SAMPLES } from '@/presets/thumbnail';
import type { Engine, KeptFinal } from '@/render/engine';
import { mapPixels } from '@/render/export';
import { encodeCrop, encodePreview, PROJECT_PREVIEW } from '@/render/preview';
import { useEditorStore } from '@/stores/editor';
import { useProjectStore } from '@/stores/project';

/** The Variants panel's thumbnail, in CSS px (its `.thumb`), and its zoom (0.5: two texels across a device pixel). */
export const CROP_SIZE = { w: 40, h: 24 };
const CROP_ZOOM = 0.5;

interface Thumb {
	preview: string;
	crop: string;
}

const thumbs = reactive(new Map<string, Thumb>());
const hashes = new Map<string, string>();
/** The samples behind each thumbnail: the shown variant's is taken again once its render has settled. */
const quality = new Map<string, number>();

/**
 * How far the viewport's render is: 0 too early for a thumbnail, 1 good enough for the shown variant's (THUMBNAIL_SAMPLES —
 * a project tracing hundreds of samples would otherwise leave it blank for a minute), 2 settled.
 */
function stage(st: { samples: number; maxSamples: number } | null): 0 | 1 | 2 {
	if (!st) return 0;
	if (st.samples >= st.maxSamples) return 2;
	return st.samples >= Math.min(st.maxSamples, THUMBNAIL_SAMPLES) ? 1 : 0;
}
let started = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** What a thumbnail depends on: the variant's project, less what never shows in the render. */
function renderHash(p: Project): string {
	return hashText(JSON.stringify({ ...p, name: '', description: '', preview: '', preset: undefined }));
}

/** Both thumbnails of a final image. */
function thumbOf({ width, height, pixels }: Omit<KeptFinal, 'samples'>, p: Project): Thumb | undefined {
	if (!width || !height) return undefined;
	const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
	return {
		preview: encodePreview(pixels, width, height, PROJECT_PREVIEW),
		crop: encodeCrop(pixels, width, height, CROP_SIZE.w * dpr, CROP_SIZE.h * dpr, p.tileable, CROP_ZOOM)
	};
}

/** Both thumbnails of what the engine shows now; undefined before anything has rendered. */
function capture(engine: Engine, p: Project): Thumb | undefined {
	try {
		return thumbOf(mapPixels(engine, 'final'), p);
	} catch (e) {
		console.warn('[bismith] variant thumbnail capture failed', e);
		return undefined;
	}
}

function start(): void {
	const store = useProjectStore();
	const editor = useEditorStore();

	const schedule = (ms = 600) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void tick(), ms);
	};

	async function tick(): Promise<void> {
		timer = null;
		const engine = editor.engine;
		if (running) return;
		// Match and Tiling drive the engine themselves; wait for the viewport to finish its render.
		if (!engine || engine.isSuspended || editor.busy || !['create', 'variants'].includes(editor.workspace)) {
			schedule(1500);
			return;
		}
		const st = editor.stats;
		const at = stage(st);
		if (!st || at === 0) return;
		const p = JSON.parse(JSON.stringify(toRaw(store.project))) as Project;
		V.syncVariants(p);
		const vs = V.variantsOf(p);
		for (const id of [...thumbs.keys()])
			if (!vs.list.some((v) => v.id === id)) {
				thumbs.delete(id);
				hashes.delete(id);
				quality.delete(id);
			}
		const stale = vs.list
			.map((v) => {
				const project = V.materialise(p, v.id);
				return { id: v.id, project, hash: renderHash(project) };
			})
			.filter(
				(s) =>
					hashes.get(s.id) !== s.hash || (at === 2 && s.id === vs.activeId && (quality.get(s.id) ?? 0) < st.samples)
			);
		const shown = stale.find((s) => s.id === vs.activeId);
		if (shown) {
			const best = engine.bestFinal(shown.project);
			const t = best ? thumbOf(best, shown.project) : capture(engine, shown.project);
			if (t) {
				thumbs.set(shown.id, t);
				hashes.set(shown.id, shown.hash);
				quality.set(shown.id, best?.samples ?? st.samples);
			}
		}
		// Variants the engine already has a good enough image of (an export, the viewport before switching) need no render.
		const others = stale.filter((s) => {
			if (s === shown) return false;
			const best = engine.bestFinal(s.project);
			const t = best && best.samples >= THUMBNAIL_SAMPLES ? thumbOf(best, s.project) : undefined;
			if (!t) return true;
			thumbs.set(s.id, t);
			hashes.set(s.id, s.hash);
			quality.set(s.id, best!.samples);
			return false;
		});
		// Rendering the others restarts the viewport: only once it has settled.
		if (!others.length || at < 2) return;
		running = true;
		try {
			const out = await renderThumbnails(
				engine,
				others.map((s) => s.project),
				toRaw(store.project),
				undefined,
				capture
			);
			others.forEach((s, i) => {
				if (!out[i]) return;
				thumbs.set(s.id, out[i]!);
				hashes.set(s.id, s.hash);
				quality.set(s.id, THUMBNAIL_SAMPLES);
			});
		} catch (e) {
			console.warn('[bismith] variant thumbnails failed', e);
		} finally {
			running = false;
		}
		// The project may have changed meanwhile.
		schedule();
	}

	watch(
		() => store.project,
		() => schedule(),
		{ deep: true }
	);
	watch(
		() => stage(editor.stats),
		(at) => at > 0 && schedule(200)
	);
	watch(
		() => editor.workspace,
		() => schedule()
	);
	schedule();
}

/** Thumbnails of the project's variants, by id (data URLs; missing until rendered): the whole texture, or its crop. */
export function useVariantThumbs(): {
	url: (id: string) => string | undefined;
	crop: (id: string) => string | undefined;
} {
	if (!started) {
		started = true;
		start();
	}
	return { url: (id) => thumbs.get(id)?.preview, crop: (id) => thumbs.get(id)?.crop };
}
