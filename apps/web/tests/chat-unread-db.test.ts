import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import pg from 'pg';

// The unread badge counts in SQL: the cursor compares (created_at, id) inside PostgreSQL so the
// microseconds a JS Date drops still count, and the sender filter has to hold for NULL senders.
// Opt-in: TEST_DATABASE_URL must name a disposable loopback database (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
	process.env.DATABASE_URL = url;
	process.env.POSTGRES_URL = url;
}

const pool = new pg.Pool({ connectionString: url || undefined, max: 3 });
const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
	(await pool.query(sql, params)).rows as T[];
const wgIds: string[] = [];

async function newWg() {
	const suffix = randomUUID().replaceAll('-', '');
	const [wg] = await q<{ id: string }>(
		'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
		[suffix.slice(0, 8).toUpperCase(), `Unread ${suffix}`],
	);
	const wgId = wg?.id ?? '';
	wgIds.push(wgId);
	const member = async (name: string) =>
		(
			await q<{ id: string }>(
				'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
				[wgId, `${name} ${suffix}`],
			)
		)[0]?.id ?? '';
	return { wgId, anna: await member('Anna'), ben: await member('Ben') };
}

async function message(
	wgId: string,
	sender: string | null,
	createdAt: string,
	extra: { actor?: string; deleted?: boolean } = {},
) {
	const [row] = await q<{ id: string }>(
		`INSERT INTO public.wg_chat_messages
		   (wg_id, sender_member_id, kind, body, system_payload, created_at, deleted_at)
		 VALUES ($1, $2, $3, 'x', $4, $5::timestamptz, $6) RETURNING id`,
		[
			wgId,
			sender,
			sender ? 'text' : 'system',
			extra.actor === undefined ? null : JSON.stringify({ actorMemberId: extra.actor }),
			createdAt,
			extra.deleted ? new Date() : null,
		],
	);
	return row?.id ?? '';
}

async function unread(wgId: string, memberId: string, cutoff: Date | null, cursor: string | null) {
	const { db, wgChatMessages } = await import('../src/core/db/index.ts');
	const { count } = await import('drizzle-orm');
	const { buildUnreadChatMessagesWhere } = await import(
		'../src/features/chat/server/chat-unread-query.ts'
	);
	const [row] = await db
		.select({ value: count(wgChatMessages.id) })
		.from(wgChatMessages)
		.where(buildUnreadChatMessagesWhere(wgChatMessages, wgId, memberId, cutoff, cursor));
	return Number(row?.value ?? 0);
}

after(async () => {
	if (skip) return;
	if (wgIds.length) await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [wgIds]);
	await pool.end();
});

test('unread counts others and their system news, not own, own-action or deleted messages', {
	skip,
}, async () => {
	const { wgId, anna, ben } = await newWg();
	const t = '2026-11-05T07:00:00.000Z';
	await message(wgId, ben, t);
	await message(wgId, anna, t);
	await message(wgId, null, t, { actor: anna });
	await message(wgId, null, t, { actor: ben });
	await message(wgId, null, t);
	await message(wgId, ben, t, { deleted: true });

	// Ben's text, the system message about Ben and the one without an actor.
	assert.equal(await unread(wgId, anna, null, null), 3);
	assert.equal(await unread(wgId, ben, null, null), 3);
	// Another flat's messages never count.
	const other = await newWg();
	assert.equal(await unread(other.wgId, anna, null, null), 0);
});

test('the read cursor keeps the microseconds a JavaScript date drops', { skip }, async () => {
	const { wgId, anna, ben } = await newWg();
	const read = await message(wgId, ben, '2026-11-05 07:00:00.123456+00');
	await message(wgId, ben, '2026-11-05 07:00:00.123789+00');
	await message(wgId, ben, '2026-11-05 07:00:01+00');
	const [row] = await q<{ created_at: Date }>(
		'SELECT created_at FROM public.wg_chat_messages WHERE id = $1',
		[read],
	);
	const cutoff = row?.created_at ?? null;

	assert.equal(await unread(wgId, anna, cutoff, read), 2);
	// The millisecond date alone would count the read message itself again (07:00:00.123 is before
	// .123456); that is why the route passes the message id whenever it has one.
	assert.equal(await unread(wgId, anna, cutoff, null), 3);
	assert.equal(await unread(wgId, anna, new Date('2026-11-05T07:00:00.999Z'), null), 1);
});
