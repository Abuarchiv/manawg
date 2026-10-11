'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * WCAG 2.4.3 / SPA route announcement.
 *
 * The WG shell's <main> never remounts across `/wg/[code]/*` client-side
 * navigations (same layout, one static per-WG <title> from generateMetadata),
 * so Next's App Router announcer has no title/h1 change to announce and focus
 * stays wherever the previous page left it (e.g. a bottom-nav link). This
 * moves focus to the shared #main landmark on every route change so screen
 * reader and keyboard users land at the top of the new view — the same
 * target the global skip link already uses.
 *
 * This layout-level effect can run after the new page's own mount effects,
 * so it only moves focus when it isn't already somewhere inside #main —
 * otherwise it would steal focus back from a page that autofocused its own
 * element (e.g. a search field) on mount.
 *
 * Used by the WG shell and by the public pages (`/`, `/entdecken/*`). The public
 * pages remount their whole tree on every route change, so a per-instance ref
 * would always start at the new pathname. The last pathname therefore lives at
 * module level and survives the remount; the first mount after the initial load
 * stays untouched.
 */
let lastPathname: string | null = null;

export function RouteFocusOnNavigate() {
	const pathname = usePathname();

	useEffect(() => {
		const previous = lastPathname;
		lastPathname = pathname;
		if (previous === null || previous === pathname) return;
		const main = document.getElementById('main');
		if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
	}, [pathname]);

	return null;
}
