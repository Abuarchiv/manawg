import { mock } from 'node:test';
// Loaded before any test mocks `drizzle-orm`, so the schema keeps the real table builders.
import * as schema from '../../src/core/db/schema';

function unavailable(name: string): never {
	throw new Error(`${name} is not part of this test's database stand-in`);
}

/**
 * Mock `@/core/db` with the real schema exports, so every module in the graph links, and the
 * given stand-ins on top (`db`, `withTransaction`, fake tables whose identity a test checks).
 */
export function mockDb(exports: Record<string, unknown>): void {
	mock.module('@/core/db', {
		namedExports: {
			...schema,
			db: new Proxy({}, { get: (_target, key) => unavailable(`db.${String(key)}`) }),
			withTransaction: () => unavailable('withTransaction'),
			...exports,
		},
	});
}
