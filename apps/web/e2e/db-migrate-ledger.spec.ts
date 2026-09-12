import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

test('rejects unknown pre-baseline ledger rows fail-closed', async () => {
	const { assertMigrationLedgerPrefix } = await import(
		pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
	);
	const arbitraryHash = 'ab'.repeat(32);
	const client = {
		query: async (sql: unknown) => {
			if (String(sql).includes('information_schema.tables')) return { rows: [{}] };
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
