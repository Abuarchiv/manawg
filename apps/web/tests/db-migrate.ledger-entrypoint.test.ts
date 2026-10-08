import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertMigrationLedgerPrefix, validateDatabaseUrl } from '../scripts/db-migrate.mjs';

// Migration entrypoint contract: transaction-pooler rejection and fail-closed ledger prefix checks.

interface DrizzleJournal {
	entries: Array<{ idx: number; tag: string; when: number }>;
}

const migrationsDir = path.resolve(process.cwd(), 'drizzle');

function readJournal(): DrizzleJournal {
	return JSON.parse(readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'));
}

function migrationHash(tag: string): string {
	return createHash('sha256')
		.update(readFileSync(path.join(migrationsDir, `${tag}.sql`), 'utf8'))
		.digest('hex');
}

/** Fake client answering the ledger existence probe and the ledger row read. */
function ledgerClient(ledger: { rows: unknown[] } | (() => never) | null) {
	return {
		query: async (sql: unknown) => {
			if (String(sql).includes('pg_catalog.pg_class')) return { rows: ledger === null ? [] : [{}] };
			if (String(sql).includes('__drizzle_migrations') && ledger !== null) {
				if (typeof ledger === 'function') return ledger();
				return ledger;
			}
			throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
		},
	};
}

test('migrations still reject transaction-pooler connections', () => {
	assert.throws(
		() =>
			validateDatabaseUrl(
				'postgresql://example:example@db.example.test:6543/app?sslmode=verify-full',
				'migration',
			),
		/must not use port 6543/,
	);
});

test('rejects unknown pre-baseline ledger rows fail-closed', async () => {
	const arbitraryHash = 'ab'.repeat(32);
	const client = ledgerClient({ rows: [{ id: 1, hash: arbitraryHash, created_at: '0' }] });

	await assert.rejects(
		assertMigrationLedgerPrefix(client),
		new Error(
			`Database check failed: unexpected migration row 1 outside the canonical ledger (hash ${arbitraryHash}, created_at 0).`,
		),
	);
});

test('accepts the reviewed historical hash at its canonical ledger position', async () => {
	const rows = readJournal().entries.map((entry, index) => ({
		id: index + 1,
		hash:
			index === 7
				? '88916329fbe6f5e5f4e4174e5db393aa3d7c4516790c4dbf3d1a41301f335aa0'
				: index === 10
					? 'fb524f9b63dd0b63b84d8d1bf6d916781e7cc206682bf23bdd0106d9e9dbbb0e'
					: migrationHash(entry.tag),
		created_at: String(entry.when),
	}));

	const ledger = await assertMigrationLedgerPrefix(ledgerClient({ rows }));
	assert.equal(ledger.appliedCount, ledger.entries.length);
});

test('keeps a missing migration ledger as missing', async () => {
	await assert.rejects(
		assertMigrationLedgerPrefix(ledgerClient(null)),
		new Error('Database check failed: Drizzle migration ledger is missing.'),
	);
});

test('propagates permission errors for an existing unreadable migration ledger', async () => {
	const client = ledgerClient(() => {
		throw new Error('permission denied for table drizzle.__drizzle_migrations');
	});

	await assert.rejects(
		assertMigrationLedgerPrefix(client),
		new Error('permission denied for table drizzle.__drizzle_migrations'),
	);
});

test('recognizes a complete canonical migration ledger without a fixed count', async () => {
	const rows = readJournal().entries.map((entry) => ({
		id: entry.idx + 1,
		hash: migrationHash(entry.tag),
		created_at: String(entry.when),
	}));

	const ledger = await assertMigrationLedgerPrefix(ledgerClient({ rows }));
	assert.equal(ledger.appliedCount, ledger.entries.length);
});
