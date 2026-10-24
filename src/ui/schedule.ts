// Yielding between steps of a long run (Match's optimiser, Tiling's fix) so the page stays responsive.
//
// requestAnimationFrame alone stalls a run in a background tab (no frames are drawn there), and timers are throttled
// to a second or more; a MessageChannel message is neither, so a hidden tab yields through one instead.

/** Resolves on the next task: lets events and other work in, without waiting for a frame. */
export function nextTask(): Promise<void> {
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => {
			channel.port1.close();
			resolve();
		};
		channel.port2.postMessage(0);
	});
}

/**
 * Resolves on the next animation frame, so progress is painted between steps — or, while the tab is hidden (and once
 * it is hidden mid-wait), on the next task, so the run keeps going in the background.
 */
export function nextFrame(): Promise<void> {
	if (typeof document === 'undefined' || document.hidden) return nextTask();
	return new Promise((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			document.removeEventListener('visibilitychange', onHidden);
			resolve();
		};
		const onHidden = () => {
			if (document.hidden) void nextTask().then(finish);
		};
		document.addEventListener('visibilitychange', onHidden);
		requestAnimationFrame(finish);
	});
}

/**
 * A yield for a run's every step that paints at most every `ms` (default 100): it resolves on the next task, and on
 * the next frame (nextFrame, so a hidden tab still runs) once `ms` have passed since the last one. Waiting for a frame
 * per step costs half a frame on average in a visible tab, a large share of a step that takes a few ms.
 */
export function yieldEvery(ms = 100): () => Promise<void> {
	let last = -Infinity;
	return async () => {
		if (performance.now() - last < ms) return nextTask();
		await nextFrame();
		last = performance.now();
	};
}
