'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Keeps the tab title on `title` while the page stays on one URL, and returns
 * the text for a live region: the router announces only route changes, so a
 * step change on the same URL is announced here. The route's streamed metadata
 * can commit its own <title> after hydration, so a later change is put back.
 */
export function useDocumentTitle(title: string): string {
	const [announcement, setAnnouncement] = useState('');
	const previousRef = useRef<string | null>(null);
	useEffect(() => {
		const apply = () => {
			if (document.title !== title) document.title = title;
		};
		apply();
		// The first title is read by the screen reader with the page itself.
		if (previousRef.current !== null && previousRef.current !== title) setAnnouncement(title);
		previousRef.current = title;
		const observer = new MutationObserver(apply);
		observer.observe(document.head, { childList: true, subtree: true, characterData: true });
		return () => observer.disconnect();
	}, [title]);
	return announcement;
}
