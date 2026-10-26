/**
 * Runs `fn` with the given environment variables set (`undefined` removes one) and restores the
 * previous values afterwards, also when `fn` throws or its promise rejects.
 */
export function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
	const previous = Object.keys(env).map((key) => [key, process.env[key]] as const);
	const apply = (values: Iterable<readonly [string, string | undefined]>) => {
		for (const [key, value] of values) {
			if (value === undefined) Reflect.deleteProperty(process.env, key);
			else process.env[key] = value;
		}
	};
	apply(Object.entries(env));
	let result: T;
	try {
		result = fn();
	} catch (error) {
		apply(previous);
		throw error;
	}
	if (result instanceof Promise) return result.finally(() => apply(previous)) as T;
	apply(previous);
	return result;
}
