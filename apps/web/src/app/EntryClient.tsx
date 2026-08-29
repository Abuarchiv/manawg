'use client';

import { getKnownWgs } from '@/shared/lib/identity';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * App entry point. On its own origin the app needs a real `/`: it is the
 * manifest's start_url, so it is where every PWA launch and every push
 * notification without a deeper target lands.
 *
 * `getKnownWgs()` returns most-recently-visited first and already swallows
 * unavailable/blocked storage by returning [] — so a private window simply
 * falls through to /neu instead of erroring.
 */
export function EntryClient() {
	const router = useRouter();

	useEffect(() => {
		const [lastVisited] = getKnownWgs();
		router.replace(lastVisited ? `/wg/${encodeURIComponent(lastVisited.code)}` : '/neu');
	}, [router]);

	// Shown for the one frame before the redirect commits. Deliberately not a
	// spinner: on a warm launch it would flash, and on a cold one the text
	// explains what is happening.
	return (
		<div className="min-h-screen bg-[var(--bg-base)] flex flex-col items-center justify-center px-4 text-center">
			<p className="text-6xl mb-4">🏠</p>
			<p className="text-[var(--text-2)]" aria-live="polite">
				ManaWG wird geöffnet …
			</p>
		</div>
	);
}
