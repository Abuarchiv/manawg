'use client';

import { useEffect } from 'react';

/**
 * Keeps the tab title on `title` while the page stays on one URL. The route's
 * streamed metadata can commit its own <title> after hydration, so a later
 * change is put back instead of being left to win.
 */
export function useDocumentTitle(title: string): void {
	useEffect(() => {
		const apply = () => {
			if (document.title !== title) document.title = title;
		};
		apply();
		const observer = new MutationObserver(apply);
		observer.observe(document.head, { childList: true, subtree: true, characterData: true });
		return () => observer.disconnect();
	}, [title]);
}
