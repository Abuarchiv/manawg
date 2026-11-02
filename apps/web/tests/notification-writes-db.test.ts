import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';

// Notification settings and push subscription writes against a real PostgreSQL: the member filter,
// endpoint ownership between accounts, the per-member cap and the unsubscribe scope live in SQL the
// mocked unit test cannot see. Opt-in: TEST_DATABASE_URL must name a disposable loopback database
// with all migrations applied (`pnpm test:db`).
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

const pool = new pg.Pool({ connectionString: url || undefined, max: 2 });
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const ids = {
	wg: '',
	otherWg: '',
	userA: randomUUID(),
	userB: randomUUID(),
	userC: randomUUID(),
	a: '',
	aOtherWg: '',
	b: '',
	gone: '',
};
const ep = (name: string) => `https://push.test/${suffix}/${name}`;
const keys = { p256dh: 'p', authKey: 'a', userAgent: null };

before(async () => {
	if (skip) return;
	for (const user of [ids.userA, ids.userB, ids.userC]) {
		await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [
			user,
			`${user}@push.test`,
		]);
	}
	const wg = async (tag: string) =>
		(
			await pool.query('INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id', [
				`${tag}${suffix.slice(0, 7)}`,
				`Push ${tag} ${suffix}`,
			])
		).rows[0].id as string;
	ids.wg = await wg('P');
	ids.otherWg = await wg('Q');
	const member = async (wgId: string, name: string, user: string, gone = false) =>
		(
			await pool.query(
				`INSERT INTO public.wg_members (wg_id, name, auth_user_id, deactivated_at)
				 VALUES ($1, $2, $3, ${gone ? 'now()' : 'NULL'}) RETURNING id`,
				[wgId, `${name} ${suffix}`, user],
			)
		).rows[0].id as string;
	ids.a = await member(ids.wg, 'A', ids.userA);
	ids.b = await member(ids.wg, 'B', ids.userB);
	ids.gone = await member(ids.wg, 'Gone', ids.userC, true);
	ids.aOtherWg = await member(ids.otherWg, 'A2', ids.userA);
});

after(async () => {
	if (skip) return;
	await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [[ids.wg, ids.otherWg]]);
	await pool.query('DELETE FROM auth.users WHERE id = ANY($1)', [
		[ids.userA, ids.userB, ids.userC],
	]);
	await pool.end();
});

const writer = (memberId: string, authUserId: string, wgId = ids.wg) => ({
	wgId,
	memberId,
	authUserId,
});
const subs = async (memberId: string) =>
	(
		await pool.query(
			'SELECT endpoint FROM public.push_subscriptions WHERE member_id = $1 ORDER BY created_at, endpoint',
			[memberId],
		)
	).rows.map((r) => (r.endpoint as string).split('/').pop());
const settings = async (memberId: string) =>
	(
		await pool.query(
			`SELECT push_opt_in AS "pushOptIn", notify_chat AS "notifyChat",
			        quiet_start_hour AS "quietStartHour", quiet_end_hour AS "quietEndHour"
			   FROM public.wg_members WHERE id = $1`,
			[memberId],
		)
	).rows[0];
const clearSubs = () =>
	pool.query('DELETE FROM public.push_subscriptions WHERE member_id = ANY($1)', [
		[ids.a, ids.aOtherWg, ids.b, ids.gone],
	]);

async function load() {
	const { withTransaction } = await import('../src/core/db/transaction.ts');
	const writes = await import('../src/app/api/wg/[code]/notifications/notification-writes.ts');
	return { withTransaction, ...writes };
}

test('settings are stored for this member only and report which fields changed', {
	skip,
}, async () => {
	const { withTransaction, updateNotificationSettings } = await load();
	const before = await settings(ids.b);
	const result = await withTransaction((tx) =>
		updateNotificationSettings(tx, writer(ids.a, ids.userA), {
			notifyChat: false,
			quietStartHour: 22,
			quietEndHour: 7,
		}),
	);
	assert.deepEqual(result?.changed.sort(), ['notifyChat', 'quietEndHour', 'quietStartHour']);
	const mine = await settings(ids.a);
	assert.equal(mine.notifyChat, false);
	assert.equal(mine.quietStartHour, 22);
	assert.equal(mine.quietEndHour, 7);
	assert.deepEqual(await settings(ids.b), before, 'a flatmate keeps their own settings');
	const again = await withTransaction((tx) =>
		updateNotificationSettings(tx, writer(ids.a, ids.userA), { quietEndHour: 7 }),
	);
	assert.deepEqual(again?.changed, []);
	const moved = await withTransaction((tx) =>
		updateNotificationSettings(tx, writer(ids.gone, ids.userC), { notifyChat: false }),
	);
	assert.equal(moved, null, 'a moved-out member cannot write settings');
});

test('another account cannot take over an endpoint; a moved-out member row is replaced', {
	skip,
}, async () => {
	const { withTransaction, subscribePush } = await load();
	await clearSubs();
	await withTransaction((tx) =>
		subscribePush(tx, writer(ids.a, ids.userA), { endpoint: ep('shared'), ...keys }),
	);
	await assert.rejects(
		withTransaction((tx) =>
			subscribePush(tx, writer(ids.b, ids.userB), { endpoint: ep('shared'), ...keys }),
		),
		(err: Error) => err.message === 'endpoint_owned',
	);
	assert.deepEqual(await subs(ids.b), []);
	// The same account reuses its browser endpoint in another flat.
	await withTransaction((tx) =>
		subscribePush(tx, writer(ids.aOtherWg, ids.userA, ids.otherWg), {
			endpoint: ep('shared'),
			...keys,
		}),
	);
	assert.deepEqual(await subs(ids.aOtherWg), ['shared']);
	// A stale row of a moved-out member on the same endpoint is dropped, not a blocker.
	await pool.query(
		'INSERT INTO public.push_subscriptions (member_id, endpoint, p256dh, auth_key) VALUES ($1,$2,$3,$4)',
		[ids.gone, ep('old'), 'p', 'a'],
	);
	await withTransaction((tx) =>
		subscribePush(tx, writer(ids.a, ids.userA), { endpoint: ep('old'), ...keys }),
	);
	assert.deepEqual(await subs(ids.gone), []);
	assert.ok((await subs(ids.a)).includes('old'));
});

test('only the newest ten subscriptions of a member are kept, a re-subscribe renews its age', {
	skip,
}, async () => {
	const { withTransaction, subscribePush } = await load();
	await clearSubs();
	await pool.query(
		'INSERT INTO public.push_subscriptions (member_id, endpoint, p256dh, auth_key) VALUES ($1,$2,$3,$4)',
		[ids.b, ep('b-keep'), 'p', 'a'],
	);
	for (let i = 0; i < 11; i += 1) {
		await withTransaction((tx) =>
			subscribePush(tx, writer(ids.a, ids.userA), { endpoint: ep(`d${i}`), ...keys }),
		);
	}
	const kept = await subs(ids.a);
	assert.equal(kept.length, 10);
	assert.ok(!kept.includes('d0') && kept.includes('d10'), 'the oldest goes, the newest stays');
	assert.deepEqual(await subs(ids.b), ['b-keep'], 'the cap never touches another member');
	// Re-subscribing the oldest endpoint renews it, so it survives the next eviction.
	await withTransaction((tx) =>
		subscribePush(tx, writer(ids.a, ids.userA), { endpoint: ep('d1'), ...keys }),
	);
	await withTransaction((tx) =>
		subscribePush(tx, writer(ids.a, ids.userA), { endpoint: ep('d11'), ...keys }),
	);
	const after = await subs(ids.a);
	assert.ok(after.includes('d1') && !after.includes('d2'));
});

test('unsubscribe is per endpoint and member; turning push off clears only this member', {
	skip,
}, async () => {
	const { withTransaction, subscribePush, unsubscribePush, updateNotificationSettings } =
		await load();
	await clearSubs();
	const subscribe = (memberId: string, user: string, name: string, wgId = ids.wg) =>
		withTransaction((tx) =>
			subscribePush(tx, writer(memberId, user, wgId), { endpoint: ep(name), ...keys }),
		);
	await subscribe(ids.a, ids.userA, 'x1');
	await subscribe(ids.a, ids.userA, 'x2');
	await subscribe(ids.b, ids.userB, 'y1');
	// Unsubscribing one endpoint keeps the other device and keeps opt-in on.
	const one = await withTransaction((tx) =>
		unsubscribePush(tx, writer(ids.a, ids.userA), ep('x1')),
	);
	assert.equal(one?.pushOptIn, true);
	assert.deepEqual(await subs(ids.a), ['x2']);
	// An endpoint of another member is not touched by this member's unsubscribe.
	await withTransaction((tx) => unsubscribePush(tx, writer(ids.a, ids.userA), ep('y1')));
	assert.deepEqual(await subs(ids.b), ['y1']);
	// The account's other flat still uses x2, so the browser keeps its subscription.
	await subscribe(ids.aOtherWg, ids.userA, 'x2', ids.otherWg);
	const shared = await withTransaction((tx) =>
		unsubscribePush(tx, writer(ids.a, ids.userA), ep('x2')),
	);
	assert.equal(shared?.endpointInUse, true);
	assert.equal(shared?.pushOptIn, false, 'the last subscription is gone, so opt-in follows');
	assert.equal((await settings(ids.a)).pushOptIn, false);
	assert.deepEqual(await subs(ids.aOtherWg), ['x2']);
	// Opting out through the settings deletes this member's subscriptions only.
	await subscribe(ids.a, ids.userA, 'x3');
	await subscribe(ids.a, ids.userA, 'x4');
	await withTransaction((tx) =>
		updateNotificationSettings(tx, writer(ids.a, ids.userA), { pushOptIn: false }),
	);
	assert.deepEqual(await subs(ids.a), []);
	assert.deepEqual(await subs(ids.b), ['y1']);
	assert.deepEqual(await subs(ids.aOtherWg), ['x2']);
});
