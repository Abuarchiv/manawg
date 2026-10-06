// Value helpers shared by unit tests and Playwright specs; free of test-runner imports.

/** JSON `Response` with the `NextResponse.json(body, init)` signature for route-module stubs. */
export function jsonResponse(body: unknown, init: number | ResponseInit = 200): Response {
	const status = typeof init === 'number' ? init : (init.status ?? 200);
	return new Response(JSON.stringify(body), {
		...(typeof init === 'number' ? {} : init),
		status,
		headers: { 'content-type': 'application/json' },
	});
}

/** Silences `console.error` and records each call until `restore()`. */
export function spyConsoleError(): { calls: unknown[][]; restore: () => void } {
	const original = console.error;
	const calls: unknown[][] = [];
	console.error = (...args: unknown[]) => {
		calls.push(args);
	};
	return {
		calls,
		restore: () => {
			console.error = original;
		},
	};
}

type Tuple<T, N extends number, R extends T[] = []> = R['length'] extends N
	? R
	: Tuple<T, N, [...R, T]>;

/** Asserts that `items` holds exactly `count` entries and types them as a tuple. */
export function tuple<T, N extends number>(items: readonly T[], count: N): Tuple<T, N> {
	if (items.length !== count) {
		throw new Error(`Expected ${count} items, got ${items.length}`);
	}
	return [...items] as Tuple<T, N>;
}

/** Narrows away `null`/`undefined` with a descriptive failure instead of a TypeError later. */
export function defined<T>(value: T | null | undefined, what = 'value'): T {
	if (value === null || value === undefined) throw new Error(`Expected ${what} to be defined`);
	return value;
}
