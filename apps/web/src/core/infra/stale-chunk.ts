/**
 * A deploy replaces the hashed /_next/static chunks; a tab opened before it (PWA users keep
 * theirs for days) gets 404 on the next lazy chunk and lands in an error boundary where
 * "Erneut versuchen" can only fail again. The fix is a reload, at most once a minute per URL so a
 * real outage does not loop while a later deploy still heals the same tab.
 */
const RELOADED_KEY = 'manawg:stale-chunk-reload';
const RELOADED_AT_KEY = 'manawg:stale-chunk-reload-at';
const GUARD_MS = 60_000;

export function isChunkLoadError(error: Error): boolean {
	return (
		error.name === 'ChunkLoadError' ||
		/Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed/i.test(
			error.message,
		)
	);
}

/** Reloads for a stale chunk and reports whether it did. */
export function reloadOnStaleChunk(error: Error): boolean {
	if (typeof window === 'undefined' || !isChunkLoadError(error)) return false;
	// Reloading offline discards the open page without being able to fetch fresh chunks.
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
	try {
		const { sessionStorage, location } = window;
		const reloadedAt = Number(sessionStorage.getItem(RELOADED_AT_KEY));
		// A missing or unparsable timestamp counts as expired.
		if (
			sessionStorage.getItem(RELOADED_KEY) === location.href &&
			Date.now() - reloadedAt < GUARD_MS
		)
			return false;
		sessionStorage.setItem(RELOADED_KEY, location.href);
		sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
	} catch {
		// Storage blocked: still reload once; the guard only matters for loops.
	}
	window.location.reload();
	return true;
}
