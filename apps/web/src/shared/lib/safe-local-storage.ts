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
