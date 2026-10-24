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
