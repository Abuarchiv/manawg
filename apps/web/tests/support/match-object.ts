import assert from 'node:assert/strict';

/**
 * Asserts that `actual` contains `expected`: objects match on the listed keys only (recursively),
 * arrays must have the same length with matching elements, and other values compare strictly.
 * This is the subset check the route tests need for response bodies and recorded calls, where
 * only some fields are under test.
 */
export function assertMatchObject(actual: unknown, expected: unknown, message?: string): void {
	if (!matches(actual, expected)) {
		assert.fail(
			message ??
				`Expected value to match object.\nactual:   ${format(actual)}\nexpected: ${format(expected)}`,
		);
	}
}

/** Whether `actual` contains `expected`, by the same rules as `assertMatchObject`. */
export function matchesObject(actual: unknown, expected: unknown): boolean {
	return matches(actual, expected);
}

function matches(actual: unknown, expected: unknown): boolean {
	if (Object.is(actual, expected)) return true;
	if (expected instanceof Date) {
		return actual instanceof Date && actual.getTime() === expected.getTime();
	}
	if (expected instanceof RegExp) {
		return actual instanceof RegExp && String(actual) === String(expected);
	}
	if (Array.isArray(expected)) {
		return (
			Array.isArray(actual) &&
			actual.length === expected.length &&
			expected.every((item, index) => matches(actual[index], item))
		);
	}
	if (expected !== null && typeof expected === 'object') {
		if (actual === null || typeof actual !== 'object') return false;
		return Object.entries(expected).every(
			([key, value]) =>
				key in (actual as object) && matches((actual as Record<string, unknown>)[key], value),
		);
	}
	return false;
}

function format(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
