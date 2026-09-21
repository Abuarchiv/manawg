import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
		`Database check failed: unexpected migration row 1 outside the canonical ledger (hash ${arbitraryHash}, created_at 0).`,
	);
});

test('accepts the reviewed historical hash at its canonical ledger position', async () => {
	const { assertMigrationLedgerPrefix } = await import(
		pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
	);
	const migrationsDir = path.resolve(process.cwd(), 'drizzle');
	const journal = JSON.parse(
		readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
	);
	const rows = journal.entries.map((entry, index) => ({
		id: index + 1,
		hash:
			index === 7
				? '88916329fbe6f5e5f4e4174e5db393aa3d7c4516790c4dbf3d1a41301f335aa0'
				: createHash('sha256')
						.update(readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), 'utf8'))
						.digest('hex'),
		created_at: String(entry.when),
	}));
	const client = {
		query: async (sql: unknown) => {
			if (String(sql).includes('pg_catalog.pg_class')) return { rows: [{}] };
			if (String(sql).includes('__drizzle_migrations')) return { rows };
			throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
		},
	};

	const ledger = await assertMigrationLedgerPrefix(client);
	expect(ledger.appliedCount).toBe(ledger.entries.length);
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

test('recognizes a complete canonical migration ledger without a fixed count', async () => {
	const { assertMigrationLedgerPrefix } = await import(
		pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
	);
	const migrationsDir = path.resolve(process.cwd(), 'drizzle');
	const journal = JSON.parse(
		readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
	);
	const client = {
		query: async (sql: unknown) => {
			if (String(sql).includes('pg_catalog.pg_class')) return { rows: [{}] };
			if (String(sql).includes('__drizzle_migrations')) {
				return {
					rows: journal.entries.map((entry) => ({
						id: entry.idx + 1,
						hash: createHash('sha256')
							.update(readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), 'utf8'))
							.digest('hex'),
						created_at: String(entry.when),
					})),
				};
			}
			throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
		},
	};

	const ledger = await assertMigrationLedgerPrefix(client);
	expect(ledger.appliedCount).toBe(ledger.entries.length);
});
