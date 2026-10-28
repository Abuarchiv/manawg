// A chainable stand-in for a Drizzle query builder: every method returns the chain, `values()` and
// `set()` are recorded, and awaiting the chain takes the next prepared result.
export interface QueryFake {
	/** The transaction/db object to hand to code under test. */
	tx: Record<string, unknown>;
	/** Rows passed to `values()`. */
	values: Record<string, unknown>[];
	/** Rows passed to `set()`. */
	sets: Record<string, unknown>[];
}

export function queryFake(results: unknown[]): QueryFake {
	const queue = [...results];
	const values: Record<string, unknown>[] = [];
	const sets: Record<string, unknown>[] = [];
	const chain: object = new Proxy(function chainRoot() {}, {
		get(_target, key) {
			if (key === 'then') {
				const next = queue.shift();
				return (resolve: (value: unknown) => void) => resolve(next);
			}
			if (key === 'values') {
				return (row: Record<string, unknown>) => {
					values.push(row);
					return chain;
				};
			}
			if (key === 'set') {
				return (row: Record<string, unknown>) => {
					sets.push(row);
					return chain;
				};
			}
			return () => chain;
		},
	});
	const tx: Record<string, unknown> = {
		select: () => chain,
		insert: () => chain,
		update: () => chain,
		execute: async () => undefined,
		transaction: async (work: (inner: unknown) => unknown) => work(tx),
	};
	return { tx, values, sets };
}
