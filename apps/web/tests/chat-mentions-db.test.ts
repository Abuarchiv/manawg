import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import pg from 'pg';

// Editing a chat message rewrites its mention rows from the new text. The matcher is unit-tested;
// the delete-then-insert per message and the flat scope are only proven against real rows.
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

async function newWg(names: string[]) {
	const suffix = randomUUID().replaceAll('-', '');
	const [wg] = await q<{ id: string }>(
		'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
		[suffix.slice(0, 8).toUpperCase(), `Chat ${suffix}`],
	);
	const wgId = wg?.id ?? '';
	wgIds.push(wgId);
	const ids: Record<string, string> = {};
	for (const name of names) {
		const [row] = await q<{ id: string }>(
			'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
			[wgId, name],
		);
		ids[name] = row?.id ?? '';
	}
	return { wgId, ids };
}

async function newMessage(wgId: string, senderMemberId: string) {
	const [row] = await q<{ id: string }>(
		`INSERT INTO public.wg_chat_messages (wg_id, sender_member_id, kind, body)
		 VALUES ($1, $2, 'text', 'hi') RETURNING id`,
		[wgId, senderMemberId],
	);
	return row?.id ?? '';
}

const mentioned = async (messageId: string) =>
	(
		await q<{ id: string }>(
			'SELECT mentioned_member_id AS id FROM public.wg_chat_mentions WHERE message_id = $1',
			[messageId],
		)
	)
		.map((row) => row.id)
		.sort();

async function edit(wgId: string, messageId: string, senderMemberId: string, body: string) {
	const { withTransaction } = await import('../src/core/db/index.ts');
	const { replaceMessageMentions } = await import('../src/features/chat/server/chat-mentions.ts');
	await withTransaction((tx) =>
		replaceMessageMentions(tx, { wgId, messageId, senderMemberId, body }),
	);
}

after(async () => {
	if (skip) return;
	if (wgIds.length) await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [wgIds]);
	await pool.end();
});

test('an edit replaces the mentions with those in the new text, never the sender', {
	skip,
}, async () => {
	const { wgId, ids } = await newWg(['Anna', 'Anna Lena', 'Ben', 'Cara']);
	const anna = ids.Anna ?? '';
	const messageId = await newMessage(wgId, anna);
	const other = await newMessage(wgId, anna);
	await edit(wgId, other, anna, '@Cara');

	await edit(wgId, messageId, anna, '@Ben and @Anna Lena, not @Anna herself');
	assert.deepEqual(await mentioned(messageId), [ids['Anna Lena'], ids.Ben].sort());

	await edit(wgId, messageId, anna, 'only @Cara now');
	assert.deepEqual(await mentioned(messageId), [ids.Cara]);

	await edit(wgId, messageId, anna, 'no one');
	assert.deepEqual(await mentioned(messageId), []);
	// Rows of other messages stay untouched.
	assert.deepEqual(await mentioned(other), [ids.Cara]);
});

test('a name from another flat is no mention', { skip }, async () => {
	const home = await newWg(['Dora']);
	const away = await newWg(['Emil']);
	const messageId = await newMessage(home.wgId, home.ids.Dora ?? '');

	await edit(home.wgId, messageId, home.ids.Dora ?? '', 'hey @Emil');
	assert.deepEqual(await mentioned(messageId), []);
	assert.ok(away.ids.Emil);
});

test('a sent mention id counts only when its @name is in the body', { skip }, async () => {
	const { wgId, ids } = await newWg(['Fiona', 'Gina', 'Hugo']);
	const { withTransaction } = await import('../src/core/db/index.ts');
	const { resolveMentionIds } = await import('../src/features/chat/server/chat-mentions.ts');
	const resolve = (body: string | null, requestedMemberIds?: string[]) =>
		withTransaction((tx) =>
			resolveMentionIds(tx, {
				wgId,
				senderMemberId: ids.Fiona ?? '',
				body,
				...(requestedMemberIds && { requestedMemberIds }),
			}),
		);
	const everyone = [ids.Gina ?? '', ids.Hugo ?? '', ids.Fiona ?? ''];

	assert.deepEqual(await resolve('hi @Gina', everyone), [ids.Gina]);
	assert.deepEqual(await resolve('hi everyone', everyone), []);
	assert.deepEqual(await resolve('hi @Gina and @Hugo', [ids.Hugo ?? '']), [ids.Hugo]);
	assert.deepEqual(await resolve('hi @Gina', ['not-a-uuid']), []);
	assert.deepEqual(await resolve(null, everyone), []);
	assert.deepEqual((await resolve('@Gina @Hugo')).sort(), [ids.Gina, ids.Hugo].sort());
});
