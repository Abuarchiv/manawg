/**
 * Whether a stored row already holds every value an update asked for. A version-guarded save
 * that misses its version is then most likely the retry of a save whose answer got lost: the
 * change is in, so the route answers with the row instead of a conflict.
 */
export function rowHoldsPatch(
	row: Record<string, unknown>,
	patch: Record<string, unknown>,
): boolean {
	return Object.entries(patch).every(([key, value]) => {
		if (value === undefined) return true;
		const stored = row[key];
		if (value instanceof Date) {
			return stored instanceof Date && stored.getTime() === value.getTime();
		}
		return JSON.stringify(stored) === JSON.stringify(value);
	});
}
