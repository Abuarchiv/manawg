import type { CachedFetchError } from '@/core/hooks/cached-fetch-store';

/**
 * Pure rules behind `useSyncedCollection`: how unconfirmed local rows sit on top of the server
 * list, and when a failed read is shown instead of the data already on screen.
 */

/**
 * Lays unconfirmed rows over a server list: a pending row with a known id replaces the server
 * row in place, a pending row the server does not know yet is listed first. A poll or cache
 * update therefore cannot flip a row back while its request is still running.
 */
export function applyPendingOverlay<TItem>(
	server: TItem[],
	pending: ReadonlyMap<string, TItem>,
	getId: (item: TItem) => string,
): TItem[] {
	if (pending.size === 0) return server;
	const known = new Set(server.map(getId));
	const added = [...pending.values()].filter((item) => !known.has(getId(item)));
	return [...added, ...server.map((item) => pending.get(getId(item)) ?? item)];
}

export interface LoadErrorContext {
	/** A background refresh (poll, focus, another hook's fetch) rather than one the user asked for. */
	silent: boolean;
	/** The list already shows data from the cache or an earlier response. */
	hasData: boolean;
}

export type HideLoadError = (error: CachedFetchError, context: LoadErrorContext) => boolean;

/** The message to show for a failed read, or null when the shown data stays without a banner. */
export function loadErrorMessage(
	error: CachedFetchError,
	context: LoadErrorContext,
	describe: (error: CachedFetchError) => string,
	hide: HideLoadError | undefined,
): string | null {
	return hide?.(error, context) ? null : describe(error);
}
