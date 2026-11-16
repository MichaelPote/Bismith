// The terms of use, agreed once per browser: until they are, TermsDialog opens over the editor before anything else
// (App), and the editor can't be used. The agreement is kept in local storage with the terms' version, so a change to
// the terms asks again. Where storage is blocked (some private windows) it asks on every visit.

/** Local storage key of the agreed version (tools/editor.ts seeds it, so the GPU tools open on the editor). */
export const TERMS_KEY = 'bismith:terms';
/** Raise this when the terms change: everyone is asked again. */
export const TERMS_VERSION = '1';

/** Whether this browser has agreed to the current terms. */
export function termsAgreed(): boolean {
	try {
		return localStorage.getItem(TERMS_KEY) === TERMS_VERSION;
	} catch {
		return false;
	}
}

/** Remembers the agreement in this browser. */
export function agreeToTerms(): void {
	try {
		localStorage.setItem(TERMS_KEY, TERMS_VERSION);
	} catch {
		// Storage blocked: the agreement lasts until the page closes.
	}
}
