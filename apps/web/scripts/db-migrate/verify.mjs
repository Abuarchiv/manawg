/**
 * The full `--check`: schema equals the latest snapshot, catalog security holds, the ledger records
 * every journal entry, existing rows satisfy the data invariants, and a rollback is observable.
 */

import { assertCatalogSecurity } from './catalog-security.mjs';
import { assertMigrationLedger } from './ledger.mjs';
import { expectedSchema, latestAvailableSnapshotTag, readMigrationJournal } from './migrations.mjs';
import { assertExpectedSchema } from './schema-check.mjs';

/** Domain rules that existing rows must satisfy, checked directly against the data. */
const DATA_CHECKS = [
	[
		'announcements.kind',
		`select count(*)::int as count from public.announcements where kind not in ('info', 'question', 'problem', 'request', 'decision')`,
	],
	[
		'announcements.status',
		`select count(*)::int as count from public.announcements where status not in ('open', 'resolved')`,
	],
	[
		'announcements.source',
		`select count(*)::int as count from public.announcements where source not in ('manual', 'system', 'chore_swap', 'expense', 'shopping')`,
	],
	[
		'chores.recurrence_type',
		`select count(*)::int as count from public.chores where recurrence_type not in ('days', 'months')`,
	],
	[
		'expense_splits.amount_cents',
		'select count(*)::int as count from public.expense_splits where amount_cents < 0',
	],
	[
		'expenses.amount_cents',
		'select count(*)::int as count from public.expenses where amount_cents <= 0',
	],
	[
		'wg_chat_messages.kind',
		`select count(*)::int as count from public.wg_chat_messages where kind not in ('text', 'image', 'system')`,
	],
];

export async function verifyDatabase(client) {
	await client.query('select 1');
	const { entries } = readMigrationJournal();
	if (!entries.at(-1)?.tag) throw new Error('Database check failed: migration journal is empty.');
	const latestSnapshotTag = latestAvailableSnapshotTag();
	const expected = expectedSchema(latestSnapshotTag);
	await assertExpectedSchema(
		client,
		latestSnapshotTag,
		`Database check failed: schema does not match ${latestSnapshotTag}.`,
		{ rejectUnexpected: true },
	);
	await assertCatalogSecurity(client, expected);
	await assertMigrationLedger(client);
	for (const [label, query] of DATA_CHECKS) {
		const { rows } = await client.query(query);
		if (Number(rows[0]?.count ?? 0) !== 0) {
			throw new Error(`Database check failed: existing data violates ${label}.`);
		}
	}

	await client.query('begin');
	try {
		await client.query('create temporary table manawg_db_check (id integer)');
		await client.query('insert into manawg_db_check values (1)');
		await client.query('rollback');
	} catch (error) {
		await client.query('rollback').catch(() => undefined);
		throw error;
	}
	const { rows } = await client.query(
		"select to_regclass('pg_temp.manawg_db_check') is null as rolled_back",
	);
	if (rows[0]?.rolled_back !== true) {
		throw new Error('Database check failed: transaction rollback was not observed.');
	}
}
