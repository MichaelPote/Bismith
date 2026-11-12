// Keyboard helpers shared by the editor's shortcut handlers.

/** Whether a key event's target takes typing (a text field, a dropdown, editable text): shortcuts leave its keys alone. */
export function isTyping(t: EventTarget | null): boolean {
	const el = t as HTMLElement | null;
	if (!el) return false;
	const tag = el.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
