/**
 * A deploy replaces the hashed /_next/static chunks; a tab opened before it (PWA users keep
 * theirs for days) gets 404 on the next lazy chunk and lands in an error boundary where
 * "Erneut versuchen" can only fail again. The fix is a reload, once per URL so a real outage
 * does not loop.
 */
const RELOADED_KEY = 'manawg:stale-chunk-reload';

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
	try {
		if (window.sessionStorage.getItem(RELOADED_KEY) === window.location.href) return false;
		window.sessionStorage.setItem(RELOADED_KEY, window.location.href);
	} catch {
		// Storage blocked: still reload once; the guard only matters for loops.
	}
	window.location.reload();
	return true;
}
