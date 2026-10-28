/**
 * Validates the Drizzle ledger against the canonical journal: every row must match the journal
 * entry at its position by hash and timestamp, or be an allowlisted historical row.
 */

import { isAllowedLegacyLedgerRow } from './legacy-adoption.mjs';
import {
	hashMigration,
	MIGRATIONS_SCHEMA,
	MIGRATIONS_TABLE,
	readMigrationJournal,
	tableExists,
} from './migrations.mjs';

/**
 * Returns how many journal entries the ledger has applied, in order. Throws on unknown, duplicate,
 * reordered or mistimed rows, and on a missing ledger table unless `requireTable` is false.
 */
export async function assertMigrationLedgerPrefix(client, { requireTable = true } = {}) {
	if (!(await tableExists(client, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE))) {
		if (requireTable)
			throw new Error('Database check failed: Drizzle migration ledger is missing.');
		return { entries: readMigrationJournal().entries, appliedCount: 0 };
	}
	const { rows } = await client.query(
		`select id, hash, created_at from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} order by id asc`,
	);
	const { entries } = readMigrationJournal();
	const canonicalEntries = entries.map((entry) => ({
		...entry,
		hash: hashMigration(entry.tag),
	}));
	const expectedByHash = new Map();
	for (const entry of canonicalEntries) {
		if (expectedByHash.has(entry.hash)) {
			throw new Error(`Migration journal has duplicate hash for ${entry.tag}.`);
		}
		expectedByHash.set(entry.hash, entry);
	}
	const appliedHashes = new Set();
	let appliedCount = 0;
	for (const row of rows) {
		const hash = typeof row.hash === 'string' ? row.hash : '';
		const createdAt = String(row.created_at ?? '');
		if (!/^[a-f0-9]{64}$/.test(hash)) {
			throw new Error(`Database check failed: invalid migration hash in ledger row ${row.id}.`);
		}
		if (!/^\d+$/.test(createdAt)) {
			throw new Error(
				`Database check failed: invalid migration timestamp in ledger row ${row.id}.`,
			);
		}

		const entry = expectedByHash.get(hash);
		if (!entry) {
			// Fail-closed: LEGACY_LEDGER_ALLOWLIST documents every tolerated
			// historical row by exact hash, timestamp, and canonical journal
			// position. Any unknown row — including arbitrary 64-hex values —
			// is rejected here and never adopted.
			if (!isAllowedLegacyLedgerRow(hash, createdAt, appliedCount)) {
				throw new Error(
					`Database check failed: unexpected migration row ${row.id} outside the canonical ledger (hash ${hash}, created_at ${createdAt}).`,
				);
			}
			if (appliedHashes.has(hash)) {
				throw new Error(`Database check failed: duplicate legacy migration row ${row.id}.`);
			}
			appliedHashes.add(hash);
			appliedCount += 1;
			continue;
		}
		if (appliedHashes.has(hash)) {
			throw new Error(`Database check failed: duplicate migration ${entry.tag}.`);
		}
		const expectedEntry = canonicalEntries[appliedCount];
		if (entry !== expectedEntry) {
			throw new Error(
				`Database check failed: migration ledger is not a canonical prefix; expected ${expectedEntry?.tag ?? 'no further migration'} before ${entry.tag}.`,
			);
		}
		if (createdAt !== String(entry.when)) {
			throw new Error(`Database check failed: timestamp mismatch for migration ${entry.tag}.`);
		}
		appliedHashes.add(hash);
		appliedCount += 1;
	}
	return { entries, appliedCount };
}

export async function assertMigrationLedger(client) {
	const { entries, appliedCount } = await assertMigrationLedgerPrefix(client);
	if (appliedCount !== entries.length) {
		throw new Error(
			`Database check failed: migration ledger is incomplete; missing migrations ${entries
				.slice(appliedCount)
				.map(({ tag }) => tag)
				.join(', ')}.`,
		);
	}
}
