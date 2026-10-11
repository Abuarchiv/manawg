import { apiFetch, mutationGeneration } from '@/core/infra/api-client';
import { captureException } from '@/core/infra/capture-client';

/**
 * Module-level read cache behind `useCachedFetch`: one snapshot per (member, URL), shared GETs,
 * and local updates that survive a refresh racing them. Kept free of React so the request and
 * rebase rules can be tested directly.
 */

export interface CachedFetchOptions {
	memberId?: string | undefined;
	headers?: HeadersInit | undefined;
}

export interface CachedFetchError {
	status: number;
	error: string;
}

export interface CachedSnapshot<T> {
	data: T | undefined;
	serverData: T | undefined;
	error: CachedFetchError | undefined;
	isLoading: boolean;
	isFetching: boolean;
	version: number;
	serverRevision: number;
}

export type CachedFetchResult<T> =
	| { ok: true; data: T; serverData: T | undefined; serverRevision: number }
	| { ok: false; status: number; error: string };

export type CachedDataUpdate<T> = T | undefined | ((current: T | undefined) => T | undefined);

export const emptyCachedSnapshot: CachedSnapshot<never> = {
	data: undefined,
	serverData: undefined,
	error: undefined,
	isLoading: true,
	isFetching: false,
	version: 0,
	serverRevision: 0,
};
const cache = new Map<string, CachedSnapshot<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const inFlight = new Map<string, Promise<void>>();
/** mutationGeneration() at the time each in-flight GET started. */
const inFlightGeneration = new Map<string, number>();
const queuedFetches = new Map<string, Promise<void>>();
const pendingUpdates = new Map<string, CachedDataUpdate<unknown>[]>();
const rebasingFetches = new Set<string>();

export function cacheKey(url: string, memberId?: string): string {
	return JSON.stringify([memberId ?? null, url]);
}

export function readCachedSnapshot<T>(key: string): CachedSnapshot<T> {
	return (
		(cache.get(key) as CachedSnapshot<T> | undefined) ?? (emptyCachedSnapshot as CachedSnapshot<T>)
	);
}

function notify(key: string): void {
	for (const listener of listeners.get(key) ?? []) listener();
}

function publish<T>(key: string, snapshot: CachedSnapshot<T>): void {
	cache.set(key, snapshot);
	notify(key);
}

export function subscribeCachedSnapshot(key: string, listener: () => void): () => void {
	const subscribers = listeners.get(key) ?? new Set<() => void>();
	subscribers.add(listener);
	listeners.set(key, subscribers);
	return () => {
		subscribers.delete(listener);
		if (subscribers.size === 0) listeners.delete(key);
	};
}

function applyUpdate<T>(update: CachedDataUpdate<T>, current: T | undefined): T | undefined {
	return typeof update === 'function'
		? (update as (current: T | undefined) => T | undefined)(current)
		: update;
}

/**
 * Overlapping refreshes (focus, polling, several hooks) share the running
 * GET. When a mutation settled after that GET started (or the caller says
 * `afterMutation`), the running GET may miss its effect, so one more GET runs
 * after it; concurrent callers share that single follow-up.
 */
export function fetchAndCache<T>(
	key: string,
	url: string,
	options: CachedFetchOptions,
	afterMutation = false,
): Promise<void> {
	const pending = inFlight.get(key);
	if (!pending) return startFetch<T>(key, url, options);
	const startedBeforeMutation = inFlightGeneration.get(key) !== mutationGeneration();
	if (!afterMutation && !startedBeforeMutation) return pending;
	const queued = queuedFetches.get(key);
	if (queued) return queued;
	const followUp = pending.then(() => {
		queuedFetches.delete(key);
		return inFlight.get(key) ?? startFetch<T>(key, url, options);
	});
	queuedFetches.set(key, followUp);
	return followUp;
}

function startFetch<T>(key: string, url: string, options: CachedFetchOptions): Promise<void> {
	const generation = mutationGeneration();
	const previous = readCachedSnapshot<T>(key);
	const requestVersion = previous.version;
	if (previous.data === undefined || pendingUpdates.has(key)) rebasingFetches.add(key);
	// The previous error stays until the response replaces it, so a retry banner keeps its button
	// (and focus) and can show a busy state instead of vanishing and reappearing.
	publish(key, {
		...previous,
		isLoading: previous.data === undefined,
		isFetching: true,
	});

	const request = apiFetch<T>(url, {
		...(options.memberId === undefined ? {} : { memberId: options.memberId }),
		...(options.headers === undefined ? {} : { headers: options.headers }),
	})
		.then((result) => {
			const current = readCachedSnapshot<T>(key);
			if (result.ok && rebasingFetches.has(key)) {
				// Local updates made while the cache was empty or rebasing are replayed on top
				// of the server data, so an optimistic change is not lost to this response.
				let data: T | undefined = result.data;
				for (const update of pendingUpdates.get(key) ?? []) {
					data = applyUpdate(update as CachedDataUpdate<T>, data);
				}
				publish(key, {
					data,
					serverData: result.data,
					error: undefined,
					isLoading: false,
					isFetching: false,
					version: current.version,
					serverRevision: current.serverRevision + 1,
				});
				pendingUpdates.delete(key);
				return;
			}
			if (result.ok && current.version !== requestVersion) {
				publish(key, { ...current, error: undefined, isLoading: false, isFetching: false });
				return;
			}
			if (result.ok) {
				publish(key, {
					data: result.data,
					serverData: result.data,
					error: undefined,
					isLoading: false,
					isFetching: false,
					version: requestVersion,
					serverRevision: current.serverRevision + 1,
				});
			} else {
				publish(key, {
					...current,
					error: { status: result.status, error: result.error },
					isLoading: false,
					isFetching: false,
				});
			}
		})
		.catch((err) => {
			captureException(err, { action: 'cachedFetch', key });
			const current = readCachedSnapshot<T>(key);
			publish(key, {
				...current,
				// Keep a real error status that was already published; 0 only marks "no response".
				error:
					current.error && current.error.status > 0
						? current.error
						: { status: 0, error: 'Netzwerkfehler' },
				isLoading: false,
				isFetching: false,
			});
		})
		.finally(() => {
			rebasingFetches.delete(key);
			if (inFlight.get(key) === request) {
				inFlight.delete(key);
				inFlightGeneration.delete(key);
			}
		});

	inFlight.set(key, request);
	inFlightGeneration.set(key, generation);
	return request;
}

/** Fetches (or joins a running fetch) and reports the cache entry it produced. */
export async function refreshCacheEntry<T>(
	key: string,
	url: string,
	options: CachedFetchOptions,
	afterMutation = false,
): Promise<CachedFetchResult<T>> {
	await fetchAndCache<T>(key, url, options, afterMutation);
	const current = readCachedSnapshot<T>(key);
	if (current.error) return { ok: false, ...current.error };
	if (current.data !== undefined) {
		return {
			ok: true,
			data: current.data,
			serverData: current.serverData,
			serverRevision: current.serverRevision,
		};
	}
	return { ok: false, status: 0, error: 'Netzwerkfehler' };
}

export function updateCache<T>(key: string, update: CachedDataUpdate<T>): void {
	const current = readCachedSnapshot<T>(key);
	const data = applyUpdate(update, current.data);
	if (data === undefined && current.data === undefined) return;
	if (current.data === undefined || rebasingFetches.has(key) || pendingUpdates.has(key)) {
		const updates = pendingUpdates.get(key) ?? [];
		updates.push(update as CachedDataUpdate<unknown>);
		pendingUpdates.set(key, updates);
	}
	publish(key, {
		data,
		serverData: current.serverData,
		error: undefined,
		isLoading: false,
		isFetching: current.isFetching,
		version: current.version + 1,
		serverRevision: current.serverRevision,
	});
}

/**
 * Refresh a cached URL without subscribing to it, e.g. a counter another hook
 * shows. Subscribing would add a mount and focus fetch on every page that only
 * wants to nudge the cache after its own mutation.
 */
export function refreshCachedFetch<T>(
	url: string,
	options: CachedFetchOptions = {},
): Promise<void> {
	return fetchAndCache<T>(cacheKey(url, options.memberId), url, options, true);
}

/**
 * Fill the cache for a URL before its page mounts (idle warm-up); the page then renders from cache.
 * An entry that already holds data needs no warm-up: its page refreshes it on mount anyway, and a
 * second GET right after the open page's own read would only cost quota.
 */
export function prefetchCachedFetch<T>(
	url: string,
	options: CachedFetchOptions = {},
): Promise<void> {
	const key = cacheKey(url, options.memberId);
	if (readCachedSnapshot<T>(key).data !== undefined) return Promise.resolve();
	return fetchAndCache<T>(key, url, options);
}
