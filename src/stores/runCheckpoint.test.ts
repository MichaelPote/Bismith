import { describe, expect, it } from 'vitest';
import { autosaveRun, runCheckpoints, timeAgo, type CheckpointBackend } from './runCheckpoint';

/** IndexedDB's behaviour that matters here: structured clones in and out, keys by id, prefix deletes. */
function memoryBackend() {
	const rows = new Map<string, unknown>();
	const backend: CheckpointBackend = {
		get: async (id) => structuredClone(rows.get(id)),
		put: async (r) => void rows.set(r.id, structuredClone(r)),
		deleteAll: async (id) => {
			for (const k of [...rows.keys()]) if (k === id || k.startsWith(`${id}/`)) rows.delete(k);
		}
	};
	return { rows, open: async () => backend };
}

describe('run checkpoints', () => {
	it('saves, loads and clears one checkpoint per workspace, with its assets', async () => {
		const mem = memoryBackend();
		const match = runCheckpoints<{ vector: Float64Array; best: number }>('match', mem.open);
		const tiling = runCheckpoints<{ n: number }>('tiling', mem.open);
		expect(await match.load()).toBe(null);
		const blob = new Blob(['png bytes'], { type: 'image/png' });
		await match.putAsset('reference', blob);
		await match.save({
			step: 3,
			loss: 0.5,
			project: '{"a":1}',
			state: { vector: Float64Array.of(1, 2), best: Infinity }
		});
		await tiling.save({ step: 9, loss: null, project: '{}', state: { n: 1 } });
		const cp = await match.load();
		expect(cp).toMatchObject({ workspace: 'match', step: 3, loss: 0.5, project: '{"a":1}' });
		expect(cp!.state.vector).toEqual(Float64Array.of(1, 2));
		expect(cp!.state.best).toBe(Infinity);
		expect(cp!.savedAt).toBeGreaterThan(Date.now() - 5000);
		expect(cp).not.toHaveProperty('id');
		expect(await (await match.getAsset<Blob>('reference'))!.text()).toBe('png bytes');
		// A save replaces the last one; the asset stays.
		await match.save({ step: 4, loss: 0.4, project: '{"a":1}', state: { vector: Float64Array.of(3), best: 0.4 } });
		expect((await match.load())!.step).toBe(4);
		expect(mem.rows.size).toBe(3);
		await match.clear();
		expect(await match.load()).toBe(null);
		expect(await match.getAsset('reference')).toBe(undefined);
		expect((await tiling.load())!.state.n).toBe(1);
	});

	it('runs operations in call order, so a clear lands after earlier saves', async () => {
		const mem = memoryBackend();
		let slow = true;
		const open = async () => {
			const b = await mem.open();
			// The first save is slow to reach storage; the clear asked for after it must still win.
			if (slow) {
				slow = false;
				await new Promise((r) => setTimeout(r, 20));
			}
			return b;
		};
		const cp = runCheckpoints<number>('match', open);
		void cp.save({ step: 1, loss: 1, project: '', state: 1 });
		await cp.clear();
		expect(await cp.load()).toBe(null);
	});

	it('never throws when storage is unavailable', async () => {
		const cp = runCheckpoints<number>('match', () => Promise.reject(new Error('no IndexedDB')));
		const warn = console.warn;
		console.warn = () => undefined;
		try {
			await cp.save({ step: 1, loss: 1, project: '', state: 1 });
			expect(await cp.load()).toBe(null);
			await cp.clear();
			expect(await cp.getAsset('x')).toBe(undefined);
		} finally {
			console.warn = warn;
		}
	});

	it('says how long ago in words', () => {
		expect(timeAgo(5000)).toBe('a few seconds');
		expect(timeAgo(60_000)).toBe('1 minute');
		expect(timeAgo(25 * 60_000)).toBe('25 minutes');
		expect(timeAgo(3 * 3600_000)).toBe('3 hours');
		expect(timeAgo(3 * 86400_000)).toBe('3 days');
	});

	it('autosaves between steps, and at once when the page is hidden, frozen or hidden mid-step', () => {
		const g = globalThis as unknown as { window?: EventTarget; document?: EventTarget & { visibilityState: string } };
		const saved = { window: g.window, document: g.document };
		g.window = new EventTarget();
		g.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
		try {
			let step = 0;
			const writes: number[] = [];
			const auto = autosaveRun(
				() => step,
				(s) => writes.push(s),
				60_000
			);
			// Not due yet: nothing written between steps.
			auto.beforeStep();
			step++;
			auto.afterStep();
			expect(writes).toEqual([]);
			// Hidden between steps: the state now.
			g.document.visibilityState = 'hidden';
			g.document.dispatchEvent(new Event('visibilitychange'));
			expect(writes).toEqual([1]);
			// Becoming visible again is no reason to save.
			g.document.visibilityState = 'visible';
			g.document.dispatchEvent(new Event('visibilitychange'));
			expect(writes).toEqual([1]);
			// Frozen mid-step: the state from before the step at once, the state after it once the step ends.
			auto.beforeStep();
			step++;
			g.document.dispatchEvent(new Event('freeze'));
			expect(writes).toEqual([1, 1]);
			auto.afterStep();
			expect(writes).toEqual([1, 1, 2]);
			g.window.dispatchEvent(new Event('pagehide'));
			expect(writes).toEqual([1, 1, 2, 2]);
			auto.stop();
			g.window.dispatchEvent(new Event('pagehide'));
			expect(writes).toHaveLength(4);
			// Periodic: due after `everyMs`.
			const every: number[] = [];
			const periodic = autosaveRun(
				() => step,
				(s) => every.push(s),
				0
			);
			periodic.beforeStep();
			periodic.afterStep();
			expect(every).toEqual([2]);
			periodic.stop();
		} finally {
			g.window = saved.window;
			g.document = saved.document;
		}
	});
});
