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
const TRANSACTION_ENV_VARS = [
	'POSTGRES_URL',
	'DATABASE_URL',
	'DATABASE_MIGRATION_URL',
	'POSTGRES_URL_NON_POOLING',
	'DATABASE_URL_UNPOOLED',
] as const;
const originalEnv = Object.fromEntries(
	TRANSACTION_ENV_VARS.map((name) => [name, process.env[name]]),
) as Record<(typeof TRANSACTION_ENV_VARS)[number], string | undefined>;

const restoreTransactionEnv = () => {
	for (const name of TRANSACTION_ENV_VARS) {
		if (originalEnv[name] === undefined) unsetEnvVar(name);
		else process.env[name] = originalEnv[name];
	}
};

const loadModule = async () => {
	vi.resetModules();
	return import('./transaction');
};

describe('withTransaction', () => {
	beforeEach(() => {
		pgPoolCtor.mockClear();
		drizzleNode.mockClear();
		for (const name of TRANSACTION_ENV_VARS) unsetEnvVar(name);
		process.env.POSTGRES_URL =
			'postgres://user:pw@ep-cool-name.eu-central-1.aws.neon.tech:5432/manawg';
	});

	afterEach(() => {
		restoreTransactionEnv();
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

		it('prefers DATABASE_MIGRATION_URL over the runtime transaction pooler', async () => {
			process.env.POSTGRES_URL =
				'postgres://user:pw@aws-0-eu-central-1.pooler.supabase.com:6543/manawg';
			process.env.DATABASE_MIGRATION_URL = 'postgres://user:pw@db.example.supabase.co:5432/manawg';
			const { withTransaction } = await loadModule();

			await withTransaction(async () => null);

			expect(pgPoolCtor).toHaveBeenCalledWith({
				connectionString: process.env.DATABASE_MIGRATION_URL,
				max: 1,
			});
		});

		it('rejects the runtime Supavisor Transaction Pooler without a direct URL', async () => {
			process.env.POSTGRES_URL =
				'postgres://user:pw@aws-0-eu-central-1.pooler.supabase.com:6543/manawg';
			const { withTransaction } = await loadModule();

			await expect(withTransaction(async () => null)).rejects.toThrow(
				/withTransaction connection.*port 6543/,
			);
			expect(pgPoolCtor).not.toHaveBeenCalled();
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
		for (const name of TRANSACTION_ENV_VARS) unsetEnvVar(name);
		const { withTransaction } = await loadModule();

		await expect(withTransaction(async () => null)).rejects.toThrow(/POSTGRES_URL/);
	});
});
