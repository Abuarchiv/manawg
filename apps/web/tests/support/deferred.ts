/**
 * A promise with its resolve and reject handles exposed, for steering concurrent test flows.
 * `resolve()` without a value is allowed for gates that only signal "now".
 */
export function deferred<T = unknown>() {
	let resolve!: (value?: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = (value) => done(value as T);
		reject = fail;
	});
	return { promise, resolve, reject };
}
