import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import pg from 'pg';

// Announcement reactions and comment edits/removals against a real PostgreSQL: WG scope, the
// resolved-post guard, per-member deletes and the moderation rules live in SQL that the fake-DB
// route tests cannot see. Opt-in: TEST_DATABASE_URL must name a disposable loopback database
// with all migrations applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname));
	process.env.DATABASE_URL = url;
	process.env.POSTGRES_URL = url;
}

// The reaction route locks the caller's account row, so the caller carries a real auth user id.
const caller = { memberId: '', name: 'Caller', authUserId: '' };
const wg = { id: '', name: 'Writes A', shareCode: 'WRT8PZAT' };
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({ ok: true, wg, member: caller, authUserId: caller.authUserId }),
	},
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});

const pool = new pg.Pool({ connectionString: url || undefined, max: 2 });
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const ids = { wgA: '', wgB: '', me: '', mate: '', admin: '', other: '' };
const authUsers = { me: randomUUID(), admin: randomUUID() };

const call = (method: string, path: string, body?: Record<string, unknown>) =>
	new NextRequest(`http://localhost/api/wg/WRT8PZAT/${path}`, {
		method,
		headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
		body: body ? JSON.stringify(body) : null,
	});
const ctx = <P extends Record<string, string>>(params: P) => ({
	params: Promise.resolve({ code: 'WRT8PZAT', ...params }),
});

async function one<T>(sql: string, params: unknown[]): Promise<T> {
	return (await pool.query(sql, params)).rows[0] as T;
}

const actAs = (who: 'me' | 'admin') => {
	caller.memberId = ids[who];
	caller.authUserId = authUsers[who];
	caller.name = who;
};

before(async () => {
	if (skip) return;
	for (const key of ['wgA', 'wgB'] as const) {
		ids[key] = (
			await one<{ id: string }>(
				'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
				[`${key === 'wgA' ? 'A' : 'B'}${suffix.slice(0, 7)}`, `Writes ${key} ${suffix}`],
			)
		).id;
	}
	const member = async (wgId: string, name: string, role: string, authUserId: string | null) =>
		(
			await one<{ id: string }>(
				'INSERT INTO public.wg_members (wg_id, name, role, auth_user_id) VALUES ($1, $2, $3, $4) RETURNING id',
				[wgId, `${name} ${suffix}`, role, authUserId],
			)
		).id;
	ids.me = await member(ids.wgA, 'Me', 'member', authUsers.me);
	ids.mate = await member(ids.wgA, 'Mate', 'member', null);
	ids.admin = await member(ids.wgA, 'Admin', 'admin', authUsers.admin);
	ids.other = await member(ids.wgB, 'Other', 'member', null);
	wg.id = ids.wgA;
	actAs('me');
});

after(async () => {
	if (skip) return;
	await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [[ids.wgA, ids.wgB]]);
	await pool.end();
});

const announcement = async (wgId: string, authorId: string, status = 'open') =>
	(
		await one<{ id: string }>(
			`INSERT INTO public.announcements (wg_id, author_member_id, content, kind, status)
			 VALUES ($1, $2, 'Post', 'question', $3) RETURNING id`,
			[wgId, authorId, status],
		)
	).id;
const react = (announcementId: string, memberId: string, reaction: string) =>
	pool.query(
		'INSERT INTO public.announcement_reactions (announcement_id, member_id, reaction) VALUES ($1, $2, $3)',
		[announcementId, memberId, reaction],
	);
const reactionRows = async (announcementId: string) =>
	(
		await pool.query(
			'SELECT member_id, reaction FROM public.announcement_reactions WHERE announcement_id = $1 ORDER BY reaction, member_id',
			[announcementId],
		)
	).rows as { member_id: string; reaction: string }[];
const reactionsRoute = () =>
	import('../src/app/api/wg/[code]/announcements/[id]/reactions/route.ts');

test('reactions: a post of another flat answers 404 and its reactions stay', { skip }, async () => {
	const { POST } = await reactionsRoute();
	const foreign = await announcement(ids.wgB, ids.other);
	await react(foreign, ids.other, 'seen');
	const added = await POST(
		call('POST', `announcements/${foreign}/reactions`, { reaction: 'seen', active: true }),
		ctx({ id: foreign }),
	);
	assert.equal(added.status, 404);
	assert.equal(((await added.json()) as { error: string }).error, 'announcement_not_found');
	const removed = await POST(
		call('POST', `announcements/${foreign}/reactions`, { reaction: 'seen', active: false }),
		ctx({ id: foreign }),
	);
	assert.equal(removed.status, 404);
	assert.deepEqual(await reactionRows(foreign), [{ member_id: ids.other, reaction: 'seen' }]);
});

test('reactions: taking a resolved post is refused, giving the take back is not', {
	skip,
}, async () => {
	const { POST } = await reactionsRoute();
	const resolved = await announcement(ids.wgA, ids.mate, 'resolved');
	const take = await POST(
		call('POST', `announcements/${resolved}/reactions`, { reaction: 'take', active: true }),
		ctx({ id: resolved }),
	);
	assert.equal(take.status, 409);
	assert.equal(((await take.json()) as { error: string }).error, 'announcement_resolved');
	assert.deepEqual(await reactionRows(resolved), []);

	await react(resolved, ids.me, 'take');
	const release = await POST(
		call('POST', `announcements/${resolved}/reactions`, { reaction: 'take', active: false }),
		ctx({ id: resolved }),
	);
	assert.equal(release.status, 200);
	assert.deepEqual(await reactionRows(resolved), []);
});

test('reactions: switching off removes only the caller own row', { skip }, async () => {
	const { POST } = await reactionsRoute();
	const post = await announcement(ids.wgA, ids.mate);
	await react(post, ids.me, 'seen');
	await react(post, ids.mate, 'seen');
	await react(post, ids.me, 'take');
	const off = await POST(
		call('POST', `announcements/${post}/reactions`, { reaction: 'seen', active: false }),
		ctx({ id: post }),
	);
	assert.equal(off.status, 200);
	const left = await reactionRows(post);
	assert.deepEqual(
		left.map((r) => `${r.member_id === ids.me ? 'me' : 'mate'}:${r.reaction}`).sort(),
		['mate:seen', 'me:take'],
	);
});

const comment = async (announcementId: string, memberId: string) =>
	(
		await one<{ id: string }>(
			`INSERT INTO public.announcement_comments (announcement_id, member_id, content)
			 VALUES ($1, $2, 'original') RETURNING id`,
			[announcementId, memberId],
		)
	).id;
const commentRoute = () =>
	import('../src/app/api/wg/[code]/announcements/[id]/comments/[commentId]/route.ts');
const commentContent = async (id: string) =>
	(
		await one<{ content: string } | undefined>(
			'SELECT content FROM public.announcement_comments WHERE id = $1',
			[id],
		)
	)?.content;
const commentPath = (post: string, id: string) => `announcements/${post}/comments/${id}`;
const moderatedFlag = async (commentId: string) => {
	const row = await one<{ metadata_json: string }>(
		`SELECT metadata_json FROM public.audit_events
		 WHERE entity_id = $1 AND event_type = 'announcement.comment.deleted'
		 ORDER BY created_at DESC LIMIT 1`,
		[commentId],
	);
	return (JSON.parse(row.metadata_json) as { moderated: boolean }).moderated;
};

test('comment DELETE: a plain member cannot remove a flatmate comment', { skip }, async () => {
	const { DELETE } = await commentRoute();
	const post = await announcement(ids.wgA, ids.mate);
	const theirs = await comment(post, ids.mate);
	const res = await DELETE(
		call('DELETE', commentPath(post, theirs)),
		ctx({ id: post, commentId: theirs }),
	);
	assert.equal(res.status, 403);
	assert.equal(await commentContent(theirs), 'original');
});

test('comment DELETE: an admin may remove it and the audit event says moderated', {
	skip,
}, async () => {
	const { DELETE } = await commentRoute();
	const post = await announcement(ids.wgA, ids.mate);
	const theirs = await comment(post, ids.mate);
	const own = await comment(post, ids.admin);
	actAs('admin');
	try {
		const removed = await DELETE(
			call('DELETE', commentPath(post, theirs)),
			ctx({ id: post, commentId: theirs }),
		);
		assert.equal(removed.status, 200);
		assert.equal(await commentContent(theirs), undefined);
		assert.equal(await moderatedFlag(theirs), true);

		const ownRemoved = await DELETE(
			call('DELETE', commentPath(post, own)),
			ctx({ id: post, commentId: own }),
		);
		assert.equal(ownRemoved.status, 200);
		assert.equal(await moderatedFlag(own), false);
	} finally {
		actAs('me');
	}
});

test('comment PATCH: even an admin cannot rewrite a flatmate comment', { skip }, async () => {
	const { PATCH } = await commentRoute();
	const post = await announcement(ids.wgA, ids.mate);
	const theirs = await comment(post, ids.mate);
	actAs('admin');
	try {
		const res = await PATCH(
			call('PATCH', commentPath(post, theirs), { content: 'rewritten' }),
			ctx({ id: post, commentId: theirs }),
		);
		assert.equal(res.status, 403);
		assert.equal(await commentContent(theirs), 'original');
	} finally {
		actAs('me');
	}
});

test('comment PATCH and DELETE: a comment of another flat answers 404', { skip }, async () => {
	const { PATCH, DELETE } = await commentRoute();
	const post = await announcement(ids.wgB, ids.other);
	const foreign = await comment(post, ids.other);
	const edit = await PATCH(
		call('PATCH', commentPath(post, foreign), { content: 'x' }),
		ctx({ id: post, commentId: foreign }),
	);
	assert.equal(edit.status, 404);
	const remove = await DELETE(
		call('DELETE', commentPath(post, foreign)),
		ctx({ id: post, commentId: foreign }),
	);
	assert.equal(remove.status, 404);
	assert.equal(await commentContent(foreign), 'original');
});

test('comment PATCH and DELETE: a moved-out author is refused', { skip }, async () => {
	const { PATCH, DELETE } = await commentRoute();
	const post = await announcement(ids.wgA, ids.mate);
	const own = await comment(post, ids.me);
	await pool.query('UPDATE public.wg_members SET deactivated_at = now() WHERE id = $1', [ids.me]);
	try {
		const edit = await PATCH(
			call('PATCH', commentPath(post, own), { content: 'x' }),
			ctx({ id: post, commentId: own }),
		);
		assert.equal(edit.status, 401);
		const remove = await DELETE(
			call('DELETE', commentPath(post, own)),
			ctx({ id: post, commentId: own }),
		);
		assert.equal(remove.status, 401);
		assert.equal(await commentContent(own), 'original');
	} finally {
		await pool.query('UPDATE public.wg_members SET deactivated_at = NULL WHERE id = $1', [ids.me]);
	}
});
