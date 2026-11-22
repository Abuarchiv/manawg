import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import pg from 'pg';

// The change poll (GET /api/wg/[code]/changes) only works if every write a list page shows moves
// the WG's version, chat traffic does not, and deleting a WG still works with the triggers on its
// cascading children. Opt-in: TEST_DATABASE_URL must name a disposable loopback database.
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
}

const pool = new pg.Pool({ connectionString: url || undefined, max: 3 });
const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
	(await pool.query(sql, params)).rows as T[];

after(async () => {
	await pool.end();
});

async function newWg() {
	const suffix = randomUUID().replaceAll('-', '');
	const [wg] = await q<{ id: string }>(
		'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
		[suffix.slice(0, 8).toUpperCase(), `Versions ${suffix}`],
	);
	const wgId = wg?.id ?? '';
	const [member] = await q<{ id: string }>(
		'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
		[wgId, `Anna ${suffix}`],
	);
	return { wgId, memberId: member?.id ?? '' };
}

async function versions(wgId: string) {
	const [row] = await q<{ data: string; members: string; chat: string }>(
		`SELECT data_version::text AS data, members_version::text AS members, chat_version::text AS chat
		 FROM public.wg_change_versions WHERE wg_id = $1`,
		[wgId],
	);
	return row ?? null;
}

test('list writes move the data version, member writes the members version', { skip }, async () => {
	const { wgId, memberId } = await newWg();
	const joined = await versions(wgId);
	assert.ok(joined && joined.members !== '0', 'a joining member moves the members version');
	assert.equal(joined.data, '0');

	const [expense] = await q<{ id: string }>(
		`INSERT INTO public.expenses (wg_id, paid_by_member_id, amount_cents, description)
		 VALUES ($1, $2, 1000, 'Milk') RETURNING id`,
		[wgId, memberId],
	);
	const afterExpense = await versions(wgId);
	assert.notEqual(afterExpense?.data, '0');
	assert.equal(afterExpense?.members, joined.members);

	// A row without wg_id finds its WG through the parent row.
	await q(
		`INSERT INTO public.expense_splits (expense_id, debtor_member_id, amount_cents)
		 VALUES ($1, $2, 1000)`,
		[expense?.id, memberId],
	);
	const afterSplit = await versions(wgId);
	assert.notEqual(afterSplit?.data, afterExpense?.data);

	await q('DELETE FROM public.expenses WHERE id = $1', [expense?.id]);
	assert.notEqual((await versions(wgId))?.data, afterSplit?.data, 'a deletion moves it too');
});

test('chat traffic moves the chat version only', { skip }, async () => {
	const { wgId, memberId } = await newWg();
	const [message] = await q<{ id: string }>(
		`INSERT INTO public.wg_chat_messages (wg_id, sender_member_id, kind, body)
		 VALUES ($1, $2, 'text', 'hi') RETURNING id`,
		[wgId, memberId],
	);
	const sent = await versions(wgId);
	assert.notEqual(sent?.chat, '0');
	await q(
		`INSERT INTO public.wg_chat_reads (wg_id, member_id, last_read_message_id) VALUES ($1, $2, $3)`,
		[wgId, memberId, message?.id],
	);
	assert.notEqual((await versions(wgId))?.chat, sent?.chat, 'a read marker moves it too');
	await q(
		`INSERT INTO public.audit_events (wg_id, member_id, event_type, entity_type, entity_id, summary)
		 VALUES ($1, $2, 'chat.message_sent', 'chat_message', $3, 'sent')`,
		[wgId, memberId, randomUUID()],
	);
	assert.equal((await versions(wgId))?.data, '0');
});

test('one transaction writes one version for many rows', { skip }, async () => {
	const { wgId, memberId } = await newWg();
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query(
			`INSERT INTO public.shopping_items (wg_id, added_by_member_id, name)
			 SELECT $1, $2, 'Item ' || n FROM generate_series(1, 50) n`,
			[wgId, memberId],
		);
		const { rows } = await client.query<{ tx: string }>('SELECT txid_current()::text AS tx');
		await client.query('COMMIT');
		assert.equal((await versions(wgId))?.data, rows[0]?.tx);
	} finally {
		client.release();
	}
});

test('deleting a WG with rows still works and leaves no version row', { skip }, async () => {
	const { wgId, memberId } = await newWg();
	await q(
		`INSERT INTO public.shopping_items (wg_id, added_by_member_id, name) VALUES ($1, $2, 'Milk')`,
		[wgId, memberId],
	);
	await q('DELETE FROM public.wgs WHERE id = $1', [wgId]);
	assert.equal(await versions(wgId), null);
});
