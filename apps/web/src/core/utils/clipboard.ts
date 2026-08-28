/**
 * Copying text to the clipboard, with the fallback the async API needs.
 *
 * `navigator.clipboard` is unavailable on insecure origins and rejects when
 * the document is not focused, which happens often enough on mobile that the
 * hidden-textarea path is not optional. Three components carried their own
 * identical copy of it.
 */

/** Deprecated `execCommand` path, for when the async clipboard is unavailable. */
export function copyViaTextArea(text: string): boolean {
	if (typeof document === 'undefined') return false;
	const textArea = document.createElement('textarea');
	textArea.value = text;
	textArea.setAttribute('readonly', '');
	textArea.style.position = 'fixed';
	textArea.style.opacity = '0';
	textArea.style.pointerEvents = 'none';
	document.body.appendChild(textArea);
	textArea.select();
	textArea.setSelectionRange(0, text.length);
	let copied = false;
	try {
		copied = document.execCommand('copy');
	} catch {
		copied = false;
	}
	document.body.removeChild(textArea);
	return copied;
}

/** Async clipboard first, hidden textarea if it is missing or refuses. */
export async function copyText(text: string): Promise<boolean> {
	const nav = typeof navigator !== 'undefined' ? navigator : null;
	if (nav?.clipboard?.writeText) {
		try {
			await nav.clipboard.writeText(text);
			return true;
		} catch {
			// Falls through to the textarea path below.
		}
	}
	return copyViaTextArea(text);
}

/** The parts of the Web Share API the invite flows use. */
export interface NavigatorWithShare {
	share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
	canShare?: (data: { title?: string; text?: string; url?: string }) => boolean;
}
