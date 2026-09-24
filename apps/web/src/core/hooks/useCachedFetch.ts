'use client';

import { apiFetch } from '@/core/infra/api-client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

interface CachedFetchOptions {
	memberId?: string | undefined;
	memberToken?: string | undefined;
	headers?: HeadersInit | undefined;
}

interface CachedFetchError {
	status: number;
	error: string;
}

interface Snapshot<T> {
	data: T | undefined;
	serverData: T | undefined;
	error: CachedFetchError | undefined;
	isLoading: boolean;
	isFetching: boolean;
	version: number;
	serverRevision: number;
}

type FetchResult<T> =
	| { ok: true; data: T; serverData: T | undefined; serverRevision: number }
	| { ok: false; status: number; error: string };
type DataUpdate<T> = T | undefined | ((current: T | undefined) => T | undefined);

const emptySnapshot: Snapshot<never> = {
	data: undefined,
	serverData: undefined,
	error: undefined,
	isLoading: true,
	isFetching: false,
	version: 0,
	serverRevision: 0,
};
const cache = new Map<string, Snapshot<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const inFlight = new Map<string, Promise<void>>();
const pendingUpdates = new Map<string, DataUpdate<unknown>[]>();
const rebasingFetches = new Set<string>();

function cacheKey(url: string, memberId?: string): string {
	return JSON.stringify([memberId ?? null, url]);
}

function snapshotFor<T>(key: string): Snapshot<T> {
	return (cache.get(key) as Snapshot<T> | undefined) ?? (emptySnapshot as Snapshot<T>);
}

function notify(key: string): void {
	for (const listener of listeners.get(key) ?? []) listener();
}

function publish<T>(key: string, snapshot: Snapshot<T>): void {
	cache.set(key, snapshot);
	notify(key);
}

function subscribe(key: string, listener: () => void): () => void {
	const subscribers = listeners.get(key) ?? new Set<() => void>();
	subscribers.add(listener);
	listeners.set(key, subscribers);
	return () => {
		subscribers.delete(listener);
		if (subscribers.size === 0) listeners.delete(key);
	};
}

async function fetchAndCache<T>(
	key: string,
	url: string,
	options: CachedFetchOptions,
): Promise<void> {
	const pending = inFlight.get(key);
	if (pending) return pending;

	const previous = snapshotFor<T>(key);
	const requestVersion = previous.version;
	if (previous.data === undefined || pendingUpdates.has(key)) rebasingFetches.add(key);
	publish(key, {
		...previous,
		error: undefined,
		isLoading: previous.data === undefined,
		isFetching: true,
	});

	const request = apiFetch<T>(url, {
		...(options.memberId === undefined ? {} : { memberId: options.memberId }),
		...(options.memberToken === undefined ? {} : { memberToken: options.memberToken }),
		...(options.headers === undefined ? {} : { headers: options.headers }),
	})
		.then((result) => {
			const current = snapshotFor<T>(key);
			if (result.ok && rebasingFetches.has(key)) {
				let data: T | undefined = result.data;
				for (const update of pendingUpdates.get(key) ?? []) {
					data =
						typeof update === 'function'
							? (update as (current: T | undefined) => T | undefined)(data)
							: (update as T | undefined);
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
			if (current.version !== requestVersion) {
				publish(key, { ...current, isLoading: false, isFetching: false });
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
		.catch(() => {
			const current = snapshotFor<T>(key);
			if (current.version !== requestVersion) {
				publish(key, { ...current, isLoading: false, isFetching: false });
				return;
			}
			publish(key, {
				...current,
				error: { status: 0, error: 'Netzwerkfehler' },
				isLoading: false,
				isFetching: false,
			});
		})
		.finally(() => {
			rebasingFetches.delete(key);
			if (inFlight.get(key) === request) inFlight.delete(key);
		});

	inFlight.set(key, request);
	return request;
}

function updateCache<T>(key: string, update: DataUpdate<T>): void {
	const current = snapshotFor<T>(key);
	const data =
		typeof update === 'function'
			? (update as (current: T | undefined) => T | undefined)(current.data)
			: update;
	if (data === undefined && current.data === undefined) return;
	if (current.data === undefined || rebasingFetches.has(key) || pendingUpdates.has(key)) {
		const updates = pendingUpdates.get(key) ?? [];
		updates.push(update as DataUpdate<unknown>);
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

export function useCachedFetch<T>(url: string, options: CachedFetchOptions = {}) {
	const { memberId, memberToken, headers } = options;
	const key = cacheKey(url, memberId);
	const getSnapshot = useCallback(() => snapshotFor<T>(key), [key]);
	const subscribeToUrl = useCallback((listener: () => void) => subscribe(key, listener), [key]);
	const snapshot = useSyncExternalStore(
		subscribeToUrl,
		getSnapshot,
		() => emptySnapshot as Snapshot<T>,
	);

	const refresh = useCallback(async (): Promise<FetchResult<T>> => {
		await fetchAndCache<T>(key, url, { memberId, memberToken, headers });
		const current = snapshotFor<T>(key);
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
	}, [headers, key, memberId, memberToken, url]);

	const setData = useCallback((update: DataUpdate<T>) => updateCache(key, update), [key]);

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
		mutate: setData,
	};
}
