// Variant thumbnails (FR10): the shown variant's captured from the viewport once its render has settled, the others
// rendered off-screen (presets/thumbnail.ts) while the viewport is idle — all stale ones in one pass, so the viewport
// restarts once. Each is a preview of the whole texture (the workspace's cards) and a crop of its middle at 50% zoom
// (the Variants panel's rows). Kept in memory by a hash of each variant's project; nothing is saved with it.

import { reactive, toRaw, watch } from 'vue';
import { hashText } from '@/core/hash';
import * as V from '@/core/variants';
import type { Project } from '@/core/project';
import { renderThumbnails } from '@/presets/thumbnail';
import type { Engine } from '@/render/engine';
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
let started = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** What a thumbnail depends on: the variant's project, less what never shows in the render. */
function renderHash(p: Project): string {
	return hashText(JSON.stringify({ ...p, name: '', description: '', preview: '', preset: undefined }));
}

/** Both thumbnails of what the engine shows now; undefined before anything has rendered. */
function capture(engine: Engine, p: Project): Thumb | undefined {
	try {
		const { width, height, pixels } = mapPixels(engine, 'final');
		if (!width || !height) return undefined;
		const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
		return {
			preview: encodePreview(pixels, width, height, PROJECT_PREVIEW),
			crop: encodeCrop(pixels, width, height, CROP_SIZE.w * dpr, CROP_SIZE.h * dpr, p.tileable, CROP_ZOOM)
		};
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
		if (!st || st.samples < st.maxSamples) return;
		const p = JSON.parse(JSON.stringify(toRaw(store.project))) as Project;
		V.syncVariants(p);
		const vs = V.variantsOf(p);
		for (const id of [...thumbs.keys()])
			if (!vs.list.some((v) => v.id === id)) {
				thumbs.delete(id);
				hashes.delete(id);
			}
		const stale = vs.list
			.map((v) => {
				const project = V.materialise(p, v.id);
				return { id: v.id, project, hash: renderHash(project) };
			})
			.filter((s) => hashes.get(s.id) !== s.hash);
		const shown = stale.find((s) => s.id === vs.activeId);
		if (shown) {
			const t = capture(engine, shown.project);
			if (t) {
				thumbs.set(shown.id, t);
				hashes.set(shown.id, shown.hash);
			}
		}
		const others = stale.filter((s) => s !== shown);
		if (!others.length) return;
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
		() => editor.stats && editor.stats.samples >= editor.stats.maxSamples,
		(done) => done && schedule(200)
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
