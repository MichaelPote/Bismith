// The editor driven by a GPU tool (tools/editor.ts; only on the dev server, with ?editor). The Windows browser can't be
// reached from WSL, so it pulls its jobs from the dev server like a headless worker (workerLoop), and for what only the
// browser can do — trusted input, screenshots — this page opens the browser's DevTools socket on itself: both are on the
// Windows side.

import { glRenderer } from './gpu/info';
import { workerLoop } from './headless';

/** A connection to the browser's DevTools, attached to this page. */
class SelfDevtools {
	private ws: WebSocket;
	private nextId = 1;
	private sessionId?: string;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	private constructor(ws: WebSocket) {
		this.ws = ws;
		ws.onmessage = (e) => {
			const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: { message: string } };
			const p = m.id === undefined ? undefined : this.pending.get(m.id);
			if (!p) return;
			this.pending.delete(m.id!);
			if (m.error) p.reject(new Error(m.error.message));
			else p.resolve(m.result);
		};
	}

	static async connect(url: string): Promise<SelfDevtools> {
		const ws = new WebSocket(url);
		await new Promise<void>((resolve, reject) => {
			ws.onopen = () => resolve();
			ws.onerror = () => reject(new Error(`could not open ${url}`));
		});
		const d = new SelfDevtools(ws);
		const { targetInfos } = (await d.send('Target.getTargets')) as {
			targetInfos: { targetId: string; type: string; url: string }[];
		};
		const self = targetInfos.find((t) => t.type === 'page' && t.url === location.href);
		if (!self) throw new Error(`no DevTools target for ${location.href}`);
		const { sessionId } = (await d.send('Target.attachToTarget', { targetId: self.targetId, flatten: true })) as {
			sessionId: string;
		};
		d.sessionId = sessionId;
		return d;
	}

	send(method: string, params: unknown = {}): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }));
		});
	}
}

function rendererInfo(): string {
	const gl = document.createElement('canvas').getContext('webgl2');
	return gl ? glRenderer(gl) : 'unknown';
}

export function startEditorDriver(worker: string): void {
	let devtools: SelfDevtools | null = null;
	void workerLoop(
		{
			rendererInfo,
			// Global scope, an expression; a promise is awaited by the loop.
			// oxlint-disable-next-line no-eval -- the point of this dev-only driver
			eval: (expr: string) => (0, eval)(expr) as unknown,
			connectCdp: async (url: string) => {
				devtools = await SelfDevtools.connect(url);
			},
			cdp: (method: string, params?: unknown) => {
				if (!devtools) throw new Error('not connected to DevTools');
				return devtools.send(method, params);
			},
			// After a moment, so that this job's result is posted first.
			reload: () => void setTimeout(() => location.reload(), 200)
		} as { rendererInfo(): string },
		worker
	);
}
