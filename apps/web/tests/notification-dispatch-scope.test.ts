import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import pg from 'pg';
import { withEnv } from './support/env.ts';

// Push dispatch against a real PostgreSQL: the recipient filter lives in SQL plus JS and the
// mocked dispatch tests (one fixed member row, any WHERE) cannot see it. Opt-in via
// TEST_DATABASE_URL (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname));
	process.env.DATABASE_URL = url;
	process.env.POSTGRES_URL = url;
}

const sent: string[] = [];
let badKeys: (endpoint: string) => boolean = () => false;
let answer: (endpoint: string) => number = () => 201;
mock.module('web-push', {
	namedExports: {
		setVapidDetails: () => {},
		sendNotification: async (sub: { endpoint: string }) => {
			sent.push(sub.endpoint);
			if (badKeys(sub.endpoint)) throw new Error('The subscription p256dh key should be 65 bytes');
			const statusCode = answer(sub.endpoint);
			if (statusCode >= 400) throw Object.assign(new Error('push failed'), { statusCode });
			return { statusCode };
		},
	},
});
const VAPID = {
	NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public',
	VAPID_PRIVATE_KEY: 'private',
	VAPID_SUBJECT: 'mailto:ops@example.test',
};

const pool = new pg.Pool({ connectionString: url || undefined, max: 2 });
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const wgs = { a: '', b: '' };
const m: Record<string, string> = {};
const endpoint = (key: string) => `https://push.test/${suffix}/${key}`;

async function addMember(wgId: string, key: string, extra = '', pushOptIn = true) {
	const { rows } = await pool.query(
		`INSERT INTO public.wg_members (wg_id, name, push_opt_in${extra ? `, ${extra.split('=')[0]}` : ''})
		 VALUES ($1, $2, $3${extra ? `, ${extra.split('=')[1]}` : ''}) RETURNING id`,
		[wgId, `${key} ${suffix}`, pushOptIn],
	);
	m[key] = rows[0].id;
	await pool.query(
		`INSERT INTO public.push_subscriptions (member_id, endpoint, p256dh, auth_key, created_at)
		 VALUES ($1, $2, 'p', 'a', now() - interval '1 day')`,
		[rows[0].id, endpoint(key)],
	);
}

before(async () => {
	if (skip) return;
	for (const key of ['a', 'b'] as const) {
		const { rows } = await pool.query(
			'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
			[`${key}${suffix.slice(0, 7)}`, `Push ${key} ${suffix}`],
		);
		wgs[key] = rows[0].id;
	}
	const hour = Number(
		new Intl.DateTimeFormat('en-GB', {
			hour: 'numeric',
			hourCycle: 'h23',
			timeZone: 'Europe/Berlin',
		}).format(new Date()),
	);
	await addMember(wgs.a, 'actor');
	await addMember(wgs.a, 'recipient');
	await addMember(wgs.a, 'mentioned');
	await addMember(wgs.a, 'optedOutChat', 'notify_chat=false');
	await addMember(wgs.a, 'noPushOptIn', '', false);
	await addMember(wgs.a, 'movedOut', 'deactivated_at=now()');
	// The window spans the hours around now so an hour change during the run keeps it active.
	await addMember(wgs.a, 'quiet', `quiet_start_hour=${(hour + 23) % 24}`);
	await pool.query(`UPDATE public.wg_members SET quiet_end_hour = $2 WHERE id = $1`, [
		m.quiet,
		(hour + 2) % 24,
	]);
	await addMember(wgs.b, 'otherWg');
});

after(async () => {
	if (skip) return;
	await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [[wgs.a, wgs.b]]);
	await pool.end();
});

async function dispatch(overrides: Record<string, unknown>) {
	const { dispatchNotification } = await import(
		'../src/core/notifications/notification-dispatch.ts'
	);
	sent.length = 0;
	await withEnv(VAPID, () =>
		dispatchNotification({
			wg: { id: wgs.a, name: 'Push A', shareCode: 'A' },
			event: 'chat.message',
			payload: { actorName: 'x', preview: 'hi' },
			...overrides,
		} as never),
	);
	return sent.map((e) => e.split('/').pop()).sort();
}

test('chat push reaches only active, opted-in, non-quiet flatmates of this WG, never the actor', {
	skip,
}, async () => {
	assert.deepEqual(await dispatch({ excludeMemberId: m.actor, excludeMemberIds: [m.mentioned] }), [
		'recipient',
	]);
});

test('a targeted push skips moved-out members, other WGs and the actor', { skip }, async () => {
	const targets = [m.mentioned, m.movedOut, m.otherWg, m.actor, m.optedOutChat];
	assert.deepEqual(
		await dispatch({ event: 'chat.mention', targetMemberIds: targets, excludeMemberId: m.actor }),
		['mentioned'],
	);
});

test('every category preference switches its own events off', { skip }, async () => {
	const cases: [string, string][] = [
		['announcement.posted', 'notify_announcements'],
		['chore.due', 'notify_chores'],
		['expense.created', 'notify_expenses'],
		['shopping.added', 'notify_shopping'],
		['inventory.low_stock', 'notify_inventory'],
		['expense.reminder', 'notify_reminders'],
		['chat.message', 'notify_chat'],
		['event.created', 'notify_events'],
	];
	for (const [event, column] of cases) {
		await pool.query(`UPDATE public.wg_members SET ${column} = false WHERE id = $1`, [m.recipient]);
		try {
			const got = await dispatch({ event, targetMemberIds: [m.recipient] });
			assert.deepEqual(got, [], `${event} must respect ${column}`);
		} finally {
			await pool.query(`UPDATE public.wg_members SET ${column} = true WHERE id = $1`, [
				m.recipient,
			]);
		}
	}
	assert.deepEqual(await dispatch({ event: 'chat.message', targetMemberIds: [m.recipient] }), [
		'recipient',
	]);
});

test('quiet hours hold normal pushes back but not urgent ones', { skip }, async () => {
	const base = { targetMemberIds: [m.quiet] };
	assert.deepEqual(await dispatch(base), []);
	assert.deepEqual(await dispatch({ ...base, event: 'chore.due', payload: {} }), ['quiet']);
});

test('bypassing preferences reaches quiet and opted-out members but still not moved-out ones', {
	skip,
}, async () => {
	const got = await dispatch({
		targetMemberIds: [m.quiet, m.optedOutChat, m.movedOut],
		bypassPreferences: true,
	});
	assert.deepEqual(got, ['optedOutChat', 'quiet']);
});

test('a gone subscription is removed for its member only and push opt-in follows', {
	skip,
}, async () => {
	answer = (e) => (e.endsWith('/recipient') ? 410 : 201);
	try {
		await dispatch({ targetMemberIds: [m.recipient, m.mentioned] });
	} finally {
		answer = () => 201;
	}
	const { rows } = await pool.query(
		'SELECT member_id FROM public.push_subscriptions WHERE member_id = ANY($1)',
		[[m.recipient, m.mentioned]],
	);
	assert.deepEqual(
		rows.map((r) => r.member_id),
		[m.mentioned],
	);
	const flag = await pool.query('SELECT push_opt_in FROM public.wg_members WHERE id = $1', [
		m.recipient,
	]);
	assert.equal(flag.rows[0].push_opt_in, false);
});

test('a fresh subscription is never removed for 404/410; a subscription with unusable keys always is', {
	skip,
}, async () => {
	await pool.query('UPDATE public.push_subscriptions SET created_at = now() WHERE member_id = $1', [
		m.mentioned,
	]);
	await pool.query(
		`INSERT INTO public.push_subscriptions (member_id, endpoint, p256dh, auth_key, created_at)
		 VALUES ($1, $2, 'p', 'a', now() - interval '1 day')`,
		[m.noPushOptIn, endpoint('noPushOptIn-2')],
	);
	answer = () => 410;
	badKeys = (e) => e.endsWith('/quiet');
	try {
		// The 410 confirmation delays are real timers, so this case takes a few seconds.
		await dispatch({ event: 'chore.due', payload: {}, targetMemberIds: [m.mentioned, m.quiet] });
	} finally {
		answer = () => 201;
		badKeys = () => false;
	}
	const left = async (id: string | undefined) =>
		(await pool.query('SELECT 1 FROM public.push_subscriptions WHERE member_id = $1', [id]))
			.rowCount;
	assert.equal(await left(m.mentioned), 1, 'a minutes-old subscription survives a 410');
	assert.equal(await left(m.quiet), 0, 'a subscription whose keys cannot encrypt is dropped');
});

test('only the gone subscription is removed, the member keeps push on their other device', {
	skip,
}, async () => {
	await pool.query(
		`UPDATE public.push_subscriptions SET created_at = now() - interval '1 day' WHERE member_id = $1`,
		[m.mentioned],
	);
	await pool.query(
		`INSERT INTO public.push_subscriptions (member_id, endpoint, p256dh, auth_key, created_at)
		 VALUES ($1, $2, 'p', 'a', now() - interval '1 day')`,
		[m.mentioned, endpoint('mentioned-2')],
	);
	answer = (e) => (e.endsWith('/mentioned') ? 410 : 201);
	try {
		await dispatch({ targetMemberIds: [m.mentioned] });
	} finally {
		answer = () => 201;
	}
	const { rows } = await pool.query(
		'SELECT endpoint FROM public.push_subscriptions WHERE member_id = $1',
		[m.mentioned],
	);
	assert.deepEqual(
		rows.map((r) => r.endpoint),
		[endpoint('mentioned-2')],
	);
	const flag = await pool.query('SELECT push_opt_in FROM public.wg_members WHERE id = $1', [
		m.mentioned,
	]);
	assert.equal(flag.rows[0].push_opt_in, true);
});
