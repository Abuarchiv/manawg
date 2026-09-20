import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

test('migrations still reject transaction-pooler connections', async () => {
	const { validateDatabaseUrl } = await import(
		pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
	);
	expect(() =>
		validateDatabaseUrl(
			'postgresql://example:example@db.example.test:6543/app?sslmode=verify-full',
			'migration',
		),
	).toThrow('must not use port 6543');
});

test('rejects unknown pre-baseline ledger rows fail-closed', async () => {
	const { assertMigrationLedgerPrefix } = await import(
		pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
	);
	const arbitraryHash = 'ab'.repeat(32);
	const client = {
		query: async (sql: unknown) => {
			if (String(sql).includes('pg_catalog.pg_class')) return { rows: [{}] };
			if (String(sql).includes('__drizzle_migrations')) {
				return { rows: [{ id: 1, hash: arbitraryHash, created_at: '0' }] };
			}
			throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
		},
	};

	await expect(assertMigrationLedgerPrefix(client)).rejects.toThrow(
		'Database check failed: unexpected migration row 1 outside the canonical ledger.',
	);
});

test('keeps a missing migration ledger as missing', async () => {
	const { assertMigrationLedgerPrefix } = await import(
		pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
	);
	const client = {
		query: async (sql: unknown) => {
			if (String(sql).includes('pg_catalog.pg_class')) return { rows: [] };
			throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
		},
	};

	await expect(assertMigrationLedgerPrefix(client)).rejects.toThrow(
		'Database check failed: Drizzle migration ledger is missing.',
	);
});

test('propagates permission errors for an existing unreadable migration ledger', async () => {
	const { assertMigrationLedgerPrefix } = await import(
		pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
	);
	const client = {
		query: async (sql: unknown) => {
			if (String(sql).includes('pg_catalog.pg_class')) return { rows: [{}] };
			if (String(sql).includes('__drizzle_migrations')) {
				throw new Error('permission denied for table drizzle.__drizzle_migrations');
			}
			throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
		},
	};

	await expect(assertMigrationLedgerPrefix(client)).rejects.toThrow(
		'permission denied for table drizzle.__drizzle_migrations',
	);
});
