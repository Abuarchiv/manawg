import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import pg from 'pg';
import { nextBerlinDayStart, startOfBerlinDay } from '../src/core/utils/berlin-day.ts';

// Who the event-reminder cron addresses, read from real rows: only active members of the WG that
// owns the event, never a member who moved out or a member of another WG. Opt-in:
// TEST_DATABASE_URL must name a disposable loopback database with all migrations applied
// (`pnpm test:db`).
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

const dispatched: { memberId: string | undefined; eventId: string }[] = [];
mock.module('@/core/infra/cron-auth', { namedExports: { requireCronSecret: () => null } });
mock.module('@/core/infra/observability', {
	namedExports: { withCronLogging: (_name: string, handler: unknown) => handler },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotification: async (input: {
			targetMemberIds: string[];
			payload: { eventId: string };
		}) => {
			dispatched.push({ memberId: input.targetMemberIds[0], eventId: input.payload.eventId });
			return { sent: 1, failures: [] };
		},
	},
});

const pool = new pg.Pool({ connectionString: url || undefined, max: 3 });
const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
	(await pool.query(sql, params)).rows as T[];
const ids = { wgA: '', wgB: '', anna: '', moved: '', foreign: '', eventA: '', eventB: '' };

before(async () => {
	if (skip) return;
	const suffix = randomUUID().replaceAll('-', '');
	for (const key of ['wgA', 'wgB'] as const) {
		const [row] = await rows<{ id: string }>(
			'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
			[`${key === 'wgA' ? 'A' : 'B'}${suffix.slice(0, 7)}`, `Rem ${key} ${suffix}`],
		);
		ids[key] = row?.id ?? '';
	}
	const member = async (wgId: string, name: string, deactivated: boolean) => {
		const [row] = await rows<{ id: string }>(
			`INSERT INTO public.wg_members (wg_id, name, push_opt_in, deactivated_at)
			 VALUES ($1, $2, true, ${deactivated ? 'now()' : 'NULL'}) RETURNING id`,
			[wgId, `${name} ${suffix}`],
		);
		const id = row?.id ?? '';
		await pool.query(
			`INSERT INTO public.push_subscriptions (member_id, endpoint, p256dh, auth_key)
			 VALUES ($1, $2, 'k', 'a')`,
			[id, `https://push.invalid/${id}`],
		);
		return id;
	};
	ids.anna = await member(ids.wgA, 'Anna', false);
	ids.moved = await member(ids.wgA, 'Moved out', true);
	ids.foreign = await member(ids.wgB, 'Foreign', false);
	const tomorrowNoon = new Date(
		nextBerlinDayStart(startOfBerlinDay(new Date())).getTime() + 12 * 3_600_000,
	);
	const event = async (wgId: string, title: string) =>
		(
			await rows<{ id: string }>(
				`INSERT INTO public.wg_events (wg_id, title, starts_at, ends_at)
				 VALUES ($1, $2, $3, $4) RETURNING id`,
				[wgId, title, tomorrowNoon, new Date(tomorrowNoon.getTime() + 3_600_000)],
			)
		)[0]?.id ?? '';
	ids.eventA = await event(ids.wgA, 'Plenum A');
	ids.eventB = await event(ids.wgB, 'Plenum B');
});

after(async () => {
	if (skip) return;
	await pool.query(
		`DELETE FROM public.idempotency_responses WHERE scope = 'event-reminders' AND key LIKE ANY($1)`,
		[[`${ids.eventA}:%`, `${ids.eventB}:%`]],
	);
	await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [[ids.wgA, ids.wgB]]);
	await pool.end();
});

test('a reminder goes to active members of the event WG only', { skip }, async () => {
	const { GET } = await import('../src/app/api/cron/event-reminders/route.ts');
	const response = await GET(
		new Request('https://example.invalid/api/cron/event-reminders') as never,
	);
	assert.equal(response.status, 200);
	const mine = dispatched.filter((d) => d.eventId === ids.eventA || d.eventId === ids.eventB);
	assert.deepEqual(
		mine.map((d) => `${d.eventId}:${d.memberId}`).sort(),
		[`${ids.eventA}:${ids.anna}`, `${ids.eventB}:${ids.foreign}`].sort(),
	);
});
