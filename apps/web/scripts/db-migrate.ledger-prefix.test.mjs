import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMigrationLedgerPrefix } from './db-migrate.mjs';

// Terra P1: an arbitrary syntactically valid 64-hex pre-baseline row must be
// rejected fail-closed. It is valid format but not an explicitly documented
// historical entry, so the canonical ledger rules must not tolerate it.
test('rejects arbitrary 64-hex pre-baseline ledger rows fail-closed', async () => {
	const arbitraryHash = 'ab'.repeat(32);
	const client = {
		query: async (sql) => {
			if (String(sql).includes('information_schema.tables')) return { rows: [{}] };
			if (String(sql).includes('__drizzle_migrations')) {
				return { rows: [{ id: 1, hash: arbitraryHash, created_at: '0' }] };
			}
			throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
		},
	};
	await assert.rejects(
		() => assertMigrationLedgerPrefix(client),
		/Database check failed: unexpected migration row 1/,
	);
});
