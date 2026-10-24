/**
 * The step Ctrl snaps a value field to: the largest of …, 0.05, 0.1, 0.5, 1, 5, 10, … that still splits the field's
 * range into at least ten divisions (0–1 → 0.1, 0–5 → 0.5, 0–360 → 10). Integer fields snap to at least 1.
 */
export function snapDivision(range: number, int = false): number {
	if (!(range > 0) || !Number.isFinite(range)) return 1;
	const eps = 1e-9;
	let d = 10 ** Math.floor(Math.log10(range / 10) + eps);
	if (range / (5 * d) >= 10 - eps) d *= 5;
	return int ? Math.max(1, d) : d;
}

/** v snapped to the nearest multiple of the division. */
export function snapTo(v: number, division: number): number {
	return Math.round(v / division) * division;
}

/** The next multiple of the division from v in direction dir (±1), skipping v itself when it is on one. */
export function snapStep(v: number, division: number, dir: number): number {
	const q = v / division;
	return (dir > 0 ? Math.floor(q + 1e-9) + 1 : Math.ceil(q - 1e-9) - 1) * division;
}
