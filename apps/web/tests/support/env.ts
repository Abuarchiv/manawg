function setEnvValues(values: Iterable<readonly [string, string | undefined]>): void {
	for (const [key, value] of values) {
		if (value === undefined) Reflect.deleteProperty(process.env, key);
		else process.env[key] = value;
	}
}

/**
 * Sets the given environment variables (`undefined` removes one) and returns a function that
 * restores the previous values. For flows whose env must outlive a single callback.
 */
export function applyEnv(env: Record<string, string | undefined>): () => void {
	const previous = Object.keys(env).map((key) => [key, process.env[key]] as const);
	setEnvValues(Object.entries(env));
	return () => setEnvValues(previous);
}

/**
 * Runs `fn` with the given environment variables set (`undefined` removes one) and restores the
 * previous values afterwards, also when `fn` throws or its promise rejects.
 */
export function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
	const restore = applyEnv(env);
	let result: T;
	try {
		result = fn();
	} catch (error) {
		restore();
		throw error;
	}
	if (result instanceof Promise) return result.finally(restore) as T;
	restore();
	return result;
}
