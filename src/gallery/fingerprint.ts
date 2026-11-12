// A hash of what this browser and computer look like, so the gallery can tell visitors apart without accounts: one
// star per project each, and a cap on how many projects one visitor publishes. A copy of the gallery's own
// (bismith-gallery: src/client/fingerprint.ts); keep the two in step, or the same browser counts as two visitors.
//
// It is deliberately coarse and zoom-proof (screen size in device pixels, not CSS pixels), and is computed once and
// remembered, so a monitor swap or a browser update doesn't make someone a new visitor. It isn't a security boundary:
// the server pairs it with per-IP limits.

import { glRenderer, glVendor } from '@/gpu/info';

const STORE_KEY = 'bismith:visitor';

function canvasSignal(): string {
	try {
		const c = document.createElement('canvas');
		c.width = 240;
		c.height = 60;
		const g = c.getContext('2d');
		if (!g) return '';
		g.textBaseline = 'top';
		g.font = '16px "Times New Roman", serif';
		g.fillStyle = '#f66e10';
		g.fillRect(4, 4, 90, 24);
		g.fillStyle = '#1e2124';
		g.fillText('Bismith ✦ forge 1.0', 8, 8);
		g.globalCompositeOperation = 'multiply';
		g.fillStyle = 'rgba(126, 169, 176, 0.7)';
		g.beginPath();
		g.arc(120, 30, 22, 0, Math.PI * 2);
		g.fill();
		return c.toDataURL();
	} catch {
		return '';
	}
}

function webglSignal(): string[] {
	try {
		const gl = document.createElement('canvas').getContext('webgl');
		if (!gl) return [];
		return [
			glVendor(gl),
			glRenderer(gl),
			String(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
			String(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE))
		];
	} catch {
		return [];
	}
}

function signals(): unknown[] {
	const nav = navigator as Navigator & { deviceMemory?: number };
	const dpr = window.devicePixelRatio || 1;
	return [
		nav.userAgent,
		nav.language,
		[...(nav.languages ?? [])].join(','),
		nav.platform,
		nav.hardwareConcurrency ?? 0,
		nav.deviceMemory ?? 0,
		nav.maxTouchPoints ?? 0,
		Math.round(screen.width * dpr),
		Math.round(screen.height * dpr),
		screen.colorDepth,
		Intl.DateTimeFormat().resolvedOptions().timeZone,
		canvasSignal(),
		...webglSignal()
	];
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let pending: Promise<string> | null = null;

/** This visitor's fingerprint: 64 hex characters, sent to the gallery as the X-Bismith-Visitor header. */
export function visitorFingerprint(): Promise<string> {
	pending ??= (async () => {
		try {
			const kept = localStorage.getItem(STORE_KEY);
			if (kept && /^[0-9a-f]{64}$/.test(kept)) return kept;
		} catch {
			/* storage unavailable: compute it each time */
		}
		const fp = await sha256Hex(JSON.stringify(signals()));
		try {
			localStorage.setItem(STORE_KEY, fp);
		} catch {
			/* not kept */
		}
		return fp;
	})();
	return pending;
}
