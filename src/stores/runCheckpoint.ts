// Checkpoints of long runs (Match's optimiser; Tiling's fix next), so a run survives the page going away mid-run —
// Chrome discarding a background tab under memory pressure reloads it without a beforeunload, a crash, a closed tab.
// One checkpoint per workspace, in IndexedDB (src/core/idb.ts, store 'checkpoints'): the run's own state (any
// structured-cloneable data, its shape up to the workspace) with a header the resume prompt reads (when, how far, which
// project). Big inputs that don't change during a run (a reference image) go in once as assets, not in every save.
//
//   const cp = runCheckpoints<MyState>('match');
//   await cp.putAsset('reference', blob);                 // once per run
//   void cp.save({ step, loss, project: json, state });   // every ~10 s, and when the page is hidden
//   await cp.clear();                                     // the run finished, or the user dropped it
//
// While a run goes on its tab holds a Web Lock (holdRunLock): another tab opened meanwhile sees the checkpoint of a live
// run, not an interrupted one, and doesn't offer to resume it (a discarded tab's locks go with it).

import { idbRun } from '@/core/idb';

export type RunWorkspace = 'match' | 'tiling';

export interface Checkpoint<T> {
	workspace: RunWorkspace;
	/** Date.now() when saved. */
	savedAt: number;
	/** How far the run had got (for the prompt): its step, and its best loss when it has one. */
	step: number;
	loss: number | null;
	/** The project open when it was saved, as JSON: resuming in another project brings it back. */
	project: string;
	/** The run had stopped (paused, finished, the workspace left) with its best not applied: reopen it, don't carry on. */
	paused?: boolean;
	state: T;
}

export type CheckpointInput<T> = Omit<Checkpoint<T>, 'workspace' | 'savedAt'>;

/** Where checkpoints are kept: IndexedDB in the app, a Map in the tests. Records carry their key as `id`. */
export interface CheckpointBackend {
	get(id: string): Promise<unknown>;
	put(record: { id: string; [key: string]: unknown }): Promise<void>;
	/** Delete every record whose id is `id` or starts with `id/`. */
	deleteAll(id: string): Promise<void>;
}

/**
 * IndexedDB. Imported statically, not on first use: a save made from a `freeze` handler has to reach IndexedDB before
 * the handler's task ends (a dynamic import resolves a task later — after the page has frozen).
 */
const S = 'checkpoints';
const idbBackend: CheckpointBackend = {
	get: (id) => idbRun(S, 'readonly', (s) => s.get(id)),
	put: (r) => idbRun(S, 'readwrite', (s) => s.put(r)).then(() => undefined),
	// '/' + U+FFFF bounds every key that starts with `id/`.
	deleteAll: (id) => idbRun(S, 'readwrite', (s) => s.delete(IDBKeyRange.bound(id, `${id}/\uffff`)))
};

export interface RunCheckpoints<T> {
	/** Save the run's state (replacing the last save). Never throws: a failed save only logs. */
	save(cp: CheckpointInput<T>): Promise<void>;
	/** The saved checkpoint, or null (none, or storage unavailable). */
	load(): Promise<Checkpoint<T> | null>;
	/** Forget the checkpoint and its assets. */
	clear(): Promise<void>;
	/** Keep an input the run needs to resume (a Blob, a data URL, an array…) until clear(). */
	putAsset(name: string, value: unknown): Promise<void>;
	getAsset<A>(name: string): Promise<A | undefined>;
}

/**
 * The checkpoint of a workspace's run. Operations run one after another in call order, so a clear() always lands after
 * the saves made before it and a late save can't bring back a checkpoint that was cleared.
 */
export function runCheckpoints<T>(
	workspace: RunWorkspace,
	backend: () => CheckpointBackend | Promise<CheckpointBackend> = () => idbBackend
): RunCheckpoints<T> {
	let queue: Promise<unknown> = Promise.resolve();
	let warned = false;
	const enqueue = <R>(f: (b: CheckpointBackend) => Promise<R>, fallback: R): Promise<R> => {
		const p = queue
			.then(async () => f(await backend()))
			.catch((e: unknown) => {
				if (!warned) console.warn(`[checkpoint] ${workspace}: storage unavailable`, e);
				warned = true;
				return fallback;
			});
		queue = p;
		return p;
	};
	return {
		save: (cp) => enqueue((b) => b.put({ id: workspace, workspace, savedAt: Date.now(), ...cp }), undefined),
		load: () =>
			enqueue(async (b) => {
				const r = (await b.get(workspace)) as (Checkpoint<T> & { id: string }) | undefined;
				if (!r || r.workspace !== workspace) return null;
				const { id: _, ...cp } = r;
				return cp as Checkpoint<T>;
			}, null),
		clear: () => enqueue((b) => b.deleteAll(workspace), undefined),
		putAsset: (name, value) => enqueue((b) => b.put({ id: `${workspace}/${name}`, value }), undefined),
		getAsset: <A>(name: string) =>
			enqueue(
				async (b) => ((await b.get(`${workspace}/${name}`)) as { value: A } | undefined)?.value,
				undefined as A | undefined
			)
	};
}

// ---------------------------------------------------------------------------------------------------- run locks

const lockName = (w: RunWorkspace) => `bismith:run:${w}`;

/**
 * Hold the workspace's run lock until the returned function is called: tells other tabs this run is alive. A no-op
 * where Web Locks are missing.
 */
export function holdRunLock(workspace: RunWorkspace): () => void {
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
	if (!locks) return () => undefined;
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	void locks.request(lockName(workspace), () => held).catch(() => undefined);
	return release;
}

/** Whether a run of the workspace is going on in some tab (its lock is held). False where Web Locks are missing. */
export async function runLockHeld(workspace: RunWorkspace): Promise<boolean> {
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
	if (!locks) return false;
	try {
		const q = await locks.query();
		return [...(q.held ?? []), ...(q.pending ?? [])].some((l) => l.name === lockName(workspace));
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------------------------------- wording

/** A time span in words, as the prompt says it: "a few seconds", "1 minute", "3 hours", "2 days". */
export function timeAgo(ms: number): string {
	const s = Math.max(0, ms) / 1000;
	const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;
	if (s < 45) return 'a few seconds';
	if (s < 3600) return unit(Math.max(1, Math.round(s / 60)), 'minute');
	if (s < 86400 * 1.5) return unit(Math.max(1, Math.round(s / 3600)), 'hour');
	return unit(Math.round(s / 86400), 'day');
}

/**
 * Saves a running job's checkpoint every `everyMs`, and at once when the page may be about to go: hidden (the user
 * switched tabs — the moment before a background discard), `pagehide`, the Page Lifecycle `freeze`. `take` snapshots
 * the job's state (cheaply: references to data it won't change), `write` stores it (RunCheckpoints.save). Call
 * `beforeStep()` / `afterStep()` around each step: state is only taken between steps, so an event that arrives while a
 * step is under way writes the state from before it at once, then the state after it. `stop()` removes the listeners.
 */
export function autosaveRun<S>(
	take: () => S,
	write: (state: S) => void,
	everyMs = 10_000
): { beforeStep(): void; afterStep(): void; stop(): void } {
	let last = Date.now();
	let before: S | null = null;
	let pending = false;
	const save = (s: S) => {
		last = Date.now();
		write(s);
	};
	const onLeave = (e: Event) => {
		if (e.type === 'visibilitychange' && document.visibilityState !== 'hidden') return;
		if (before === null) save(take());
		else {
			save(before);
			pending = true;
		}
	};
	const win = typeof window !== 'undefined' ? window : null;
	const listen = (on: boolean) => {
		if (!win) return;
		const f = on ? 'addEventListener' : 'removeEventListener';
		document[f]('visibilitychange', onLeave);
		document[f]('freeze', onLeave);
		win[f]('pagehide', onLeave);
	};
	listen(true);
	return {
		beforeStep() {
			before = take();
		},
		afterStep() {
			before = null;
			if (pending || Date.now() - last >= everyMs) {
				pending = false;
				save(take());
			}
		},
		stop() {
			listen(false);
		}
	};
}
