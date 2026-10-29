'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Moves focus to #main after every client-side route change (WCAG 2.4.3), because the
 * shared <main> does not remount and Next's announcer sees no title change. Skips the
 * first mount and any navigation where focus is already inside #main (a page may have
 * autofocused a field). The last pathname lives at module level because the public
 * pages remount their tree on every route change.
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
