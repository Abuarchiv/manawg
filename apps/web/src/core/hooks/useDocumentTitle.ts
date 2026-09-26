'use client';

import { useEffect } from 'react';

/**
 * Sets `document.title` for routes rendered by a client component.
 *
 * Next.js `generateMetadata`/`metadata` only run in Server Components. The
 * `/wg/[code]/*` feature pages fetch their data client-side (`'use client'`),
 * so they all inherit the WG layout's title and would otherwise render the
 * exact same document title for every page — a WCAG 2.4.2 violation. Call
 * this once per page with a descriptive title instead.
 *
 * Restores the previous title on cleanup. This hook writes `document.title`
 * outside React's own metadata rendering, so without this restore, a page
 * that only inherits its title from a layout (e.g. the WG dashboard) could
 * be left showing a previous page's title after a client-side navigation
 * back to it, depending on how the framework's own title reconciliation
 * behaves. Cheap to do defensively even where current Next.js versions
 * happen to re-assert the layout title on every route change anyway.
 */
export function useDocumentTitle(title: string): void {
	useEffect(() => {
		const previousTitle = document.title;
		document.title = title;
		return () => {
			document.title = previousTitle;
		};
	}, [title]);
}
