'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
	type CachedDataUpdate,
	type CachedFetchOptions,
	type CachedFetchResult,
	type CachedSnapshot,
	cacheKey,
	emptyCachedSnapshot,
	readCachedSnapshot,
	refreshCacheEntry,
	subscribeCachedSnapshot,
	updateCache,
} from './cached-fetch-store';

export type { CachedFetchResult } from './cached-fetch-store';
export { prefetchCachedFetch, refreshCachedFetch } from './cached-fetch-store';

/** Subscribes to one cached URL; fetches on mount and on window focus. */
export function useCachedFetch<T>(url: string, options: CachedFetchOptions = {}) {
	const { memberId, headers } = options;
	const key = cacheKey(url, memberId);
	const getSnapshot = useCallback(() => readCachedSnapshot<T>(key), [key]);
	const subscribeToUrl = useCallback(
		(listener: () => void) => subscribeCachedSnapshot(key, listener),
		[key],
	);
	const snapshot = useSyncExternalStore(
		subscribeToUrl,
		getSnapshot,
		() => emptyCachedSnapshot as CachedSnapshot<T>,
	);

	const refresh = useCallback(
		({ afterMutation = false }: { afterMutation?: boolean } = {}): Promise<CachedFetchResult<T>> =>
			refreshCacheEntry<T>(key, url, { memberId, headers }, afterMutation),
		[headers, key, memberId, url],
	);

	const setData = useCallback((update: CachedDataUpdate<T>) => updateCache(key, update), [key]);

	useEffect(() => {
		void refresh();
		const onFocus = () => void refresh();
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [refresh]);

	return {
		data: snapshot.data,
		serverData: snapshot.serverData,
		error: snapshot.error,
		isLoading: snapshot.isLoading,
		isFetching: snapshot.isFetching,
		serverRevision: snapshot.serverRevision,
		refresh,
		setData,
	};
}
