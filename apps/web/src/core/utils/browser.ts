/**
 * `window.localStorage` throws in some privacy modes and is absent during SSR;
 * every reader wants the same "null instead of throw" behaviour.
 */
export function safeLocalStorage(): Storage | null {
	if (typeof window === 'undefined') return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

/**
 * True while an input/textarea/contentEditable is focused, e.g. typing a chat
 * message. Prompts fixed above the bottom nav sit exactly where composers do,
 * so showing one mid-keystroke would steal the tap meant for "send".
 */
export function isEditingTarget(): boolean {
	const active = document.activeElement;
	return (
		active instanceof HTMLElement &&
		(active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
	);
}
