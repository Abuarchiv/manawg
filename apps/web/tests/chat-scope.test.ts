import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import pg from 'pg';

// Chat listing, send, read marker and reactions against a real PostgreSQL: ordering, cursor paging, WG scope
// and who is pushed live in SQL that the fake-DB route tests cannot see. Opt-in: TEST_DATABASE_URL
// must name a disposable loopback database with all migrations applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname));
	process.env.DATABASE_URL = url;
	process.env.POSTGRES_URL = url;
}

const caller = { memberId: '', name: 'Caller' };
const wg = { id: '', name: 'Chat A', shareCode: 'MTE8PZAT' };
const dispatched: Record<string, unknown>[] = [];
mock.module('@/core/guards/require-wg-member', {
	namedExports: { requireWgMember: async () => ({ ok: true, wg, member: caller }) },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		chatMessageLimiter: {},
		chatReadLimiter: {},
		wgWriteLimiter: {},
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async (input: Record<string, unknown>) => {
			dispatched.push(input);
			return { sent: 0, warning: null };
		},
	},
});

const pool = new pg.Pool({ connectionString: url || undefined, max: 2 });
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const ids = { wgA: '', wgB: '', me: '', mate: '', other: '', otherMsg: '' };
const route = () => import('../src/app/api/wg/[code]/chat/messages/route.ts');
const ctx = { params: Promise.resolve({ code: 'MTE8PZAT' }) };
const get = async (query = '') => {
	const { GET } = await route();
	const res = await GET(
		new NextRequest(`http://localhost/api/wg/MTE8PZAT/chat/messages${query}`),
		ctx,
	);
	assert.equal(res.status, 200, await res.clone().text());
	return (await res.json()) as {
		messages: { id: string; createdAt: string; body: string | null }[];
		reads?: unknown[];
	};
};
const send = async (body: Record<string, unknown>) => {
	const { POST } = await route();
	return POST(
		new NextRequest('http://localhost/api/wg/MTE8PZAT/chat/messages', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
			body: JSON.stringify(body),
		}),
		ctx,
	);
};
async function message(wgId: string, senderId: string, body: string, at: string, id?: string) {
	const { rows } = await pool.query(
		`INSERT INTO public.wg_chat_messages (id, wg_id, sender_member_id, kind, body, created_at)
		 VALUES (COALESCE($5::uuid, gen_random_uuid()), $1, $2, 'text', $3, $4::timestamptz) RETURNING id`,
		[wgId, senderId, body, at, id ?? null],
	);
	return rows[0].id as string;
}

before(async () => {
	if (skip) return;
	for (const key of ['wgA', 'wgB'] as const) {
		const { rows } = await pool.query(
			'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
			[`${key === 'wgA' ? 'A' : 'B'}${suffix.slice(0, 7)}`, `Chat ${key} ${suffix}`],
		);
		ids[key] = rows[0].id;
	}
	const member = async (wgId: string, name: string) =>
		(
			await pool.query('INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id', [
				wgId,
				`${name} ${suffix}`,
			])
		).rows[0].id as string;
	ids.me = await member(ids.wgA, 'Me');
	ids.mate = await member(ids.wgA, 'Mate');
	ids.other = await member(ids.wgB, 'Other');
	wg.id = ids.wgA;
	caller.memberId = ids.me;
	caller.name = `Me ${suffix}`;
});

after(async () => {
	if (skip) return;
	await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [[ids.wgA, ids.wgB]]);
	await pool.end();
});

test('chat pages newest first, with no gap or duplicate across a same-timestamp tie, scoped to the WG', {
	skip,
}, async () => {
	const t = (s: number) => `2026-01-01T10:00:0${s}.000000Z`;
	const tieId = (n: number) => `00000000-0000-4000-8000-0000000000b${n}`;
	const oldest = await message(
		ids.wgA,
		ids.mate,
		'm1',
		t(1),
		'00000000-0000-4000-8000-0000000000a1',
	);
	// Seven messages share one timestamp. They are inserted in an order that is neither ascending
	// nor descending by id, so only the id tie-break yields the expected sequence.
	for (const n of [4, 1, 6, 3, 7, 2, 5])
		await message(ids.wgA, ids.mate, `tie ${n}`, t(2), tieId(n));
	const newest = await message(
		ids.wgA,
		ids.mate,
		'm5',
		t(3),
		'00000000-0000-4000-8000-0000000000c1',
	);
	ids.otherMsg = await message(ids.wgB, ids.other, 'foreign', t(2));
	await pool.query(
		'INSERT INTO public.wg_chat_reads (wg_id, member_id, last_read_message_id) VALUES ($1,$2,$3)',
		[ids.wgB, ids.other, ids.otherMsg],
	);
	await pool.query(
		'INSERT INTO public.wg_chat_reads (wg_id, member_id, last_read_message_id) VALUES ($1,$2,$3)',
		[ids.wgA, ids.mate, oldest],
	);

	const expected = [newest, ...[7, 6, 5, 4, 3, 2, 1].map(tieId), oldest];
	// A page is returned oldest first; the pages themselves walk from the newest backwards.
	const pageIds = (page: { messages: { id: string }[] }) =>
		page.messages.map((m) => m.id).reverse();
	const first = await get('?limit=2');
	assert.deepEqual(pageIds(first), expected.slice(0, 2));
	assert.equal(first.reads?.length, 1, 'only the read markers of this WG');
	// Walk every page through the tie with the cursor of the last row of the previous page.
	const walked = pageIds(first);
	let last = first.messages[0] ?? assert.fail('first page is empty');
	for (let page = 0; page < 6 && walked.length < expected.length; page++) {
		const next = await get(
			`?limit=2&before=${encodeURIComponent(last.createdAt)}&beforeId=${last.id}`,
		);
		assert.deepEqual(next.reads, [], 'a cursor page carries no read markers');
		if (next.messages.length === 0) break;
		walked.push(...pageIds(next));
		last = next.messages[0] ?? assert.fail('page is empty');
	}
	assert.deepEqual(walked, expected, 'no gap and no duplicate across the tie');
	// A cursor from another WG pages nothing instead of leaking that WG's history.
	const foreign = await get(`?limit=5&before=2026-01-01T10:00:02.000Z&beforeId=${ids.otherMsg}`);
	assert.deepEqual(foreign.messages, []);
	// A refresh id of another WG is not returned either.
	const refreshed = await get(`?limit=1&refreshId=${ids.otherMsg}`);
	assert.deepEqual(
		refreshed.messages.map((m) => m.id),
		[newest],
	);
	assert.equal((refreshed as { refreshedMessages?: unknown[] }).refreshedMessages?.length ?? 0, 0);
});

test('a send pushes flatmates but never the sender, mentions get only the targeted push, scoped to the WG', {
	skip,
}, async () => {
	dispatched.length = 0;
	const res = await send({
		body: `hi @Mate ${suffix} @Me ${suffix}`,
		mentionMemberIds: [ids.mate, ids.me, ids.other],
	});
	assert.equal(res.status, 200, await res.clone().text());
	const json = (await res.json()) as { mentions: string[] };
	assert.deepEqual(json.mentions, [ids.mate], 'no self mention, no member of another WG');
	const general = dispatched.find((d) => d.event === 'chat.message');
	const mention = dispatched.find((d) => d.event === 'chat.mention');
	assert.equal(general?.excludeMemberId, ids.me);
	assert.deepEqual(general?.excludeMemberIds, [ids.mate]);
	assert.deepEqual(mention?.targetMemberIds, [ids.mate]);
	assert.equal(mention?.excludeMemberId, ids.me);
});

test('a reply target must be a live message of this WG', { skip }, async () => {
	const foreign = await send({ body: 'x', replyToMessageId: ids.otherMsg });
	assert.equal(foreign.status, 400);
	const live = await message(ids.wgA, ids.mate, 'to delete', '2026-01-01T10:00:09Z');
	await pool.query('UPDATE public.wg_chat_messages SET deleted_at = now() WHERE id = $1', [live]);
	assert.equal((await send({ body: 'x', replyToMessageId: live })).status, 400);
});

test('the read marker of another WG message is refused', { skip }, async () => {
	const { POST } = await import('../src/app/api/wg/[code]/chat/read/route.ts');
	const res = await POST(
		new NextRequest('http://localhost/api/wg/MTE8PZAT/chat/read', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ lastReadMessageId: ids.otherMsg }),
		}),
		ctx,
	);
	assert.equal(res.status, 404);
	const { rows } = await pool.query('SELECT 1 FROM public.wg_chat_reads WHERE member_id = $1', [
		ids.me,
	]);
	assert.equal(rows.length, 0);
});

test('unread count: own and deleted messages, and other WGs excluded', {
	skip,
}, async () => {
	const { GET } = await import('../src/app/api/wg/[code]/chat/unread-count/route.ts');
	// Starts from an empty chat so earlier tests' messages do not count.
	await pool.query('DELETE FROM public.wg_chat_messages WHERE wg_id = ANY($1)', [
		[ids.wgA, ids.wgB],
	]);
	const t = (s: number) => `2026-01-02T10:00:0${s}.000000Z`;
	const marker = await message(ids.wgA, ids.mate, 'read', t(1));
	await pool.query(
		'INSERT INTO public.wg_chat_reads (wg_id, member_id, last_read_message_id) VALUES ($1,$2,$3)',
		[ids.wgA, ids.me, marker],
	);
	await message(ids.wgA, ids.mate, 'unread', t(2));
	await message(ids.wgA, ids.me, 'mine', t(3));
	const del = await message(ids.wgA, ids.mate, 'deleted', t(4));
	await pool.query('UPDATE public.wg_chat_messages SET deleted_at = now() WHERE id = $1', [del]);
	await message(ids.wgB, ids.other, 'foreign', t(5));
	const res = await GET(new NextRequest('http://localhost/api/wg/MTE8PZAT/chat/unread-count'), ctx);
	const body = (await res.json()) as Record<string, unknown>;
	assert.equal(body.exactCount, 1);
});

test('an edit re-derives mentions from the new text: never the author, only members of this WG', {
	skip,
}, async () => {
	const { PATCH } = await import('../src/app/api/wg/[code]/chat/messages/[id]/route.ts');
	const id = await message(ids.wgA, ids.me, 'first', new Date().toISOString());
	const edit = (body: string) =>
		PATCH(
			new NextRequest(`http://localhost/api/wg/MTE8PZAT/chat/messages/${id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ body }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id }) },
		);
	const mentioned = async () =>
		(
			await pool.query(
				'SELECT mentioned_member_id FROM public.wg_chat_mentions WHERE message_id = $1',
				[id],
			)
		).rows.map((r) => r.mentioned_member_id);
	const res = await edit(`@Me ${suffix} @Mate ${suffix} @Other ${suffix} hello`);
	assert.equal(res.status, 200, await res.clone().text());
	assert.deepEqual(await mentioned(), [ids.mate]);
	assert.equal((await edit('no mention any more')).status, 200);
	assert.deepEqual(await mentioned(), []);
});

const reactionsRoute = () =>
	import('../src/app/api/wg/[code]/chat/messages/[id]/reactions/route.ts');
const reactionCall = (method: 'POST' | 'DELETE', id: string, emoji: string) =>
	new NextRequest(
		`http://localhost/api/wg/MTE8PZAT/chat/messages/${id}/reactions${method === 'DELETE' ? `?emoji=${encodeURIComponent(emoji)}` : ''}`,
		{
			method,
			headers: { 'content-type': 'application/json' },
			body: method === 'POST' ? JSON.stringify({ emoji }) : null,
		},
	);
const reactionCtx = (id: string) => ({ params: Promise.resolve({ code: 'MTE8PZAT', id }) });
const reactionRows = async (messageId: string) =>
	(
		await pool.query(
			'SELECT member_id, emoji FROM public.wg_chat_reactions WHERE message_id = $1 ORDER BY emoji',
			[messageId],
		)
	).rows as { member_id: string; emoji: string }[];
const addReaction = (messageId: string, memberId: string, emoji: string) =>
	pool.query(
		'INSERT INTO public.wg_chat_reactions (message_id, member_id, emoji) VALUES ($1,$2,$3)',
		[messageId, memberId, emoji],
	);

test('a reaction on a message of another WG is refused and nothing is stored or removed', {
	skip,
}, async () => {
	const { POST, DELETE } = await reactionsRoute();
	const foreign = await message(ids.wgB, ids.other, 'foreign', '2026-01-03T10:00:00Z');
	const added = await POST(reactionCall('POST', foreign, '👍'), reactionCtx(foreign));
	assert.equal(added.status, 404);
	assert.deepEqual(await reactionRows(foreign), []);
	await addReaction(foreign, ids.other, '👍');
	const removed = await DELETE(reactionCall('DELETE', foreign, '👍'), reactionCtx(foreign));
	assert.equal(removed.status, 404);
	assert.equal((await reactionRows(foreign)).length, 1);
});

test('a deleted message refuses adding and removing a reaction with 409', { skip }, async () => {
	const { POST, DELETE } = await reactionsRoute();
	const gone = await message(ids.wgA, ids.mate, 'gone', '2026-01-03T10:00:01Z');
	await pool.query('UPDATE public.wg_chat_messages SET deleted_at = now() WHERE id = $1', [gone]);
	const added = await POST(reactionCall('POST', gone, '👍'), reactionCtx(gone));
	assert.equal(added.status, 409);
	assert.deepEqual(await reactionRows(gone), []);
	await addReaction(gone, ids.me, '👍');
	const removed = await DELETE(reactionCall('DELETE', gone, '👍'), reactionCtx(gone));
	assert.equal(removed.status, 409);
	assert.equal((await reactionRows(gone)).length, 1);
});

test('removing a reaction deletes only the caller row with that emoji', { skip }, async () => {
	const { POST, DELETE } = await reactionsRoute();
	const msg = await message(ids.wgA, ids.mate, 'react', '2026-01-03T10:00:02Z');
	const added = await POST(reactionCall('POST', msg, '🎉'), reactionCtx(msg));
	assert.equal(added.status, 200);
	await addReaction(msg, ids.me, '👍');
	await addReaction(msg, ids.mate, '👍');
	const removed = await DELETE(reactionCall('DELETE', msg, '👍'), reactionCtx(msg));
	assert.equal(removed.status, 200);
	assert.deepEqual(
		(await reactionRows(msg))
			.map((r) => `${r.member_id === ids.me ? 'me' : 'mate'}${r.emoji}`)
			.sort(),
		['me🎉', 'mate👍'].sort(),
	);
});

test('reaction emoji guards: adding needs a single emoji, removing an emoji of at most 16 characters', {
	skip,
}, async () => {
	const { POST, DELETE } = await reactionsRoute();
	const msg = await message(ids.wgA, ids.mate, 'guards', '2026-01-03T10:00:03Z');
	for (const bad of ['not an emoji', 'ab', '👍👍']) {
		const refused = await POST(reactionCall('POST', msg, bad), reactionCtx(msg));
		assert.equal(refused.status, 400, bad);
	}
	assert.deepEqual(await reactionRows(msg), []);
	await addReaction(msg, ids.me, 'x'.repeat(17));
	for (const bad of ['x'.repeat(17), '   ', 'a\u0000b']) {
		const refused = await DELETE(reactionCall('DELETE', msg, bad), reactionCtx(msg));
		assert.equal(refused.status, 400, JSON.stringify(bad));
	}
	assert.equal((await reactionRows(msg)).length, 1);
});
