import { describe, expect, it } from 'vitest';
import { nextFrame, nextTask } from './schedule';

describe('schedule', () => {
	it('yields to the next task without frames (a hidden tab, or no document)', async () => {
		const order: string[] = [];
		const p = nextTask().then(() => order.push('task'));
		order.push('sync');
		await p;
		expect(order).toEqual(['sync', 'task']);
		await expect(nextFrame()).resolves.toBeUndefined();
	});

	it('stops waiting for a frame once the tab is hidden', async () => {
		const listeners = new Set<() => void>();
		const doc = {
			hidden: false,
			addEventListener: (_: string, f: () => void) => listeners.add(f),
			removeEventListener: (_: string, f: () => void) => listeners.delete(f)
		};
		const g = globalThis as Record<string, unknown>;
		const saved = { document: g.document, requestAnimationFrame: g.requestAnimationFrame };
		g.document = doc;
		g.requestAnimationFrame = () => 0; // a background tab: no frame ever comes
		try {
			let done = false;
			const p = nextFrame().then(() => (done = true));
			await nextTask();
			expect(done).toBe(false);
			doc.hidden = true;
			for (const f of [...listeners]) f();
			await p;
			expect(done).toBe(true);
			expect(listeners.size).toBe(0);
		} finally {
			Object.assign(g, saved);
		}
	});
});
