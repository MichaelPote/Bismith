// Variant thumbnails (FR10): the shown variant's captured from the viewport once its render has settled, the others
// rendered off-screen (presets/thumbnail.ts) while the viewport is idle — all stale ones in one pass, so the viewport
// restarts once. Kept in memory by a hash of each variant's project; nothing is saved with it.

import { reactive, toRaw, watch } from 'vue';
import { hashText } from '@/core/hash';
import * as V from '@/core/variants';
import type { Project } from '@/core/project';
import { renderThumbnails } from '@/presets/thumbnail';
import { capturePreview, PROJECT_PREVIEW } from '@/render/preview';
import { useEditorStore } from '@/stores/editor';
import { useProjectStore } from '@/stores/project';

const urls = reactive(new Map<string, string>());
const hashes = new Map<string, string>();
let started = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** What a thumbnail depends on: the variant's project, less what never shows in the render. */
function renderHash(p: Project): string {
	return hashText(JSON.stringify({ ...p, name: '', description: '', preview: '', preset: undefined }));
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
		for (const id of [...urls.keys()])
			if (!vs.list.some((v) => v.id === id)) {
				urls.delete(id);
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
			const url = capturePreview(engine, PROJECT_PREVIEW);
			if (url) {
				urls.set(shown.id, url);
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
				PROJECT_PREVIEW
			);
			others.forEach((s, i) => {
				if (!out[i]) return;
				urls.set(s.id, out[i]!);
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

/** Thumbnails of the project's variants, by id (data URLs; missing until rendered). */
export function useVariantThumbs(): { url: (id: string) => string | undefined } {
	if (!started) {
		started = true;
		start();
	}
	return { url: (id) => urls.get(id) };
}
