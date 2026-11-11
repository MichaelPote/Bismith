// The modal UI that is open — dialogs (DialogFrame) and anchored questions (AnchoredAsk) — newest last. Esc answers only
// the top one, and the editor's shortcuts wait while any is open (App's onKey): a Del or Ctrl+Z pressed in a dialog
// must not reach the layers behind it.

const open: object[] = [];

/** Registers a modal as open (on mount); returns its token. */
export function openModal(): object {
	const token = {};
	open.push(token);
	return token;
}

/** Unregisters it (on unmount). */
export function closeModal(token: object): void {
	const i = open.indexOf(token);
	if (i >= 0) open.splice(i, 1);
}

/** Whether `token` is the newest open modal (the one Esc answers). */
export const isTopModal = (token: object) => open[open.length - 1] === token;

/** Whether any modal is open. */
export const modalOpen = () => open.length > 0;
