import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { unsetEnvVar } from '@/test/env';

const pgPoolCtor = vi.fn();
const drizzleNode = vi.fn();

vi.mock('pg', () => ({
	Pool: class {
		constructor(config: unknown) {
			pgPoolCtor(config);
		}
		on() {}
	},
}));

vi.mock('drizzle-orm/node-postgres', () => ({
	drizzle: (...args: unknown[]) => {
		drizzleNode(...args);
		return { transaction: vi.fn(async (cb: (arg: unknown) => unknown) => cb({ marker: 'tx' })) };
	},
}));

const txStub = { marker: 'tx' };

const loadModule = async () => {
	vi.resetModules();
	return import('./transaction');
};

describe('withTransaction', () => {
	beforeEach(() => {
		pgPoolCtor.mockClear();
		drizzleNode.mockClear();
		process.env.POSTGRES_URL = 'postgres://user:pw@ep-cool-name.eu-central-1.aws.neon.tech/manawg';
	});

	afterEach(() => {
		unsetEnvVar('POSTGRES_URL');
	});

	it('returns whatever the callback returns', async () => {
		const { withTransaction } = await loadModule();

		await expect(withTransaction(async () => 'done')).resolves.toBe('done');
	});

	it('hands the callback a transaction handle rather than the plain db', async () => {
		const { withTransaction } = await loadModule();

		const received = await withTransaction(async (tx) => tx);

		expect(received).toStrictEqual(txStub);
	});

	it('lets the callback error propagate, so drizzle rolls back', async () => {
		const { withTransaction } = await loadModule();
		const boom = new Error('split_insert_failed');

		await expect(withTransaction(async () => Promise.reject(boom))).rejects.toBe(boom);
	});

	describe('driver selection', () => {
		it('uses pg.Pool for a remote url', async () => {
			const { withTransaction } = await loadModule();

			await withTransaction(async () => null);

			expect(pgPoolCtor).toHaveBeenCalledWith({ connectionString: expect.any(String), max: 1 });
			expect(drizzleNode).toHaveBeenCalled();
		});

		it('uses pg.Pool for a local url', async () => {
			process.env.POSTGRES_URL = 'postgres://user:pw@localhost:5432/manawg';
			const { withTransaction } = await loadModule();

			await withTransaction(async () => null);

			expect(pgPoolCtor).toHaveBeenCalledWith({ connectionString: expect.any(String), max: 1 });
			expect(drizzleNode).toHaveBeenCalled();
		});
	});

	it('builds the pool once and reuses it across calls', async () => {
		const { withTransaction } = await loadModule();

		await withTransaction(async () => null);
		await withTransaction(async () => null);
		await withTransaction(async () => null);

		expect(pgPoolCtor).toHaveBeenCalledTimes(1);
	});

	describe('TransactionAbort', () => {
		it('carries the api error code the route should answer with', async () => {
			const { TransactionAbort } = await loadModule();

			const abort = new TransactionAbort('split_insert_failed');

			expect(abort.code).toBe('split_insert_failed');
			expect(abort).toBeInstanceOf(Error);
			expect(abort.message).toBe('split_insert_failed');
		});

		it('travels out of withTransaction unchanged', async () => {
			const { TransactionAbort, withTransaction } = await loadModule();
			const abort = new TransactionAbort('insert_failed');

			await expect(
				withTransaction(async () => {
					throw abort;
				}),
			).rejects.toBe(abort);
		});

		it('is distinguishable from an arbitrary driver error', async () => {
			const { TransactionAbort } = await loadModule();

			expect(new Error('connection terminated')).not.toBeInstanceOf(TransactionAbort);
		});
	});

	it('surfaces the actionable error when no connection string is configured', async () => {
		unsetEnvVar('POSTGRES_URL');
		unsetEnvVar('DATABASE_URL');
		const { withTransaction } = await loadModule();

		await expect(withTransaction(async () => null)).rejects.toThrow(/POSTGRES_URL/);
	});
});
