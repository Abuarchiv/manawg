/**
 * Applies `update` to the list stored under `key` of a cached response and keeps the other
 * fields. Without a cache entry the local list is the base; an unchanged list creates none.
 */
export function updateCachedList<K extends string, T, R extends Record<K, T[]>>(
	current: R | undefined,
	key: K,
	localList: T[],
	update: (list: T[]) => T[],
): R | undefined {
	const previous = current?.[key] ?? localList;
	const next = update(previous);
	if (!current && next === previous) return current;
	// The spread of a generic record widens to an index signature; R is the same shape.
	return { ...(current ?? { [key]: previous }), [key]: next } as R;
}
