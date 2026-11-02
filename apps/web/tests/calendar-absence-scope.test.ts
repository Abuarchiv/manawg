import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import pg from 'pg';

// SQL that mocked route tests cannot see: an absence only collides with the same member's own
// absences (two flatmates can be away together), and an admin of one WG cannot cancel an
// occurrence of another WG's series. Opt-in: TEST_DATABASE_URL must name a disposable loopback
// database with all migrations applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
	// The app connection avoids index scans so the (wg_id, start_date) index cannot supply the
	// sort order that the list route must request with ORDER BY.
	const appUrl = new URL(url);
	appUrl.searchParams.set('options', '-c enable_indexscan=off -c enable_bitmapscan=off');
	process.env.DATABASE_URL = appUrl.toString();
	process.env.POSTGRES_URL = appUrl.toString();
}

const code = 'ABS8PZAT';
const wg = { id: '', name: 'WG A' };
const caller = { memberId: '', name: 'Anna' };
mock.module('@/core/guards/require-wg-member', {
	namedExports: { requireWgMember: async () => ({ ok: true, wg, member: caller }) },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});
mock.module('@/features/events/server/event-change-notification', {
	namedExports: { notifyOccurrenceChange: () => undefined },
});

const pool = new pg.Pool({ connectionString: url || undefined, max: 3 });
const ids = { wgA: '', wgB: '', anna: '', ben: '', foreignAdmin: '', foreignMember: '' };
const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
	(await pool.query(sql, params)).rows as T[];
const ctx = (extra: Record<string, string> = {}) =>
	({ params: Promise.resolve({ code, ...extra }) }) as never;

before(async () => {
	if (skip) return;
	const suffix = randomUUID().replaceAll('-', '');
	for (const key of ['wgA', 'wgB'] as const) {
		const [row] = await rows<{ id: string }>(
			'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
			[`${key === 'wgA' ? 'A' : 'B'}${suffix.slice(0, 7)}`, `Abs ${key} ${suffix}`],
		);
		ids[key] = row?.id ?? '';
	}
	const member = async (wgId: string, name: string, role: string) =>
		(
			await rows<{ id: string }>(
				'INSERT INTO public.wg_members (wg_id, name, role) VALUES ($1, $2, $3) RETURNING id',
				[wgId, `${name} ${suffix}`, role],
			)
		)[0]?.id ?? '';
	ids.anna = await member(ids.wgA, 'Anna', 'admin');
	ids.ben = await member(ids.wgA, 'Ben', 'member');
	ids.foreignAdmin = await member(ids.wgB, 'Foreign admin', 'admin');
	ids.foreignMember = await member(ids.wgB, 'Foreign member', 'member');
	wg.id = ids.wgA;
	caller.memberId = ids.anna;
});

after(async () => {
	if (skip) return;
	await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [[ids.wgA, ids.wgB]]);
	await pool.end();
});

function createAbsence(memberId: string, startDate: string, endDate: string): never {
	return new NextRequest(`https://example.invalid/api/wg/${code}/absences`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ memberId, startDate, endDate }),
	}) as never;
}

test('two members of one WG can be away on the same days, one member cannot overlap themselves', {
	skip,
}, async () => {
	const { POST } = await import('../src/app/api/wg/[code]/absences/route.ts');
	const start = '2031-07-01T00:00:00.000Z';
	const end = '2031-07-10T21:59:59.999Z';
	caller.memberId = ids.anna;
	assert.equal((await POST(createAbsence(ids.anna, start, end), ctx())).status, 200);
	// Anna is the admin and books Ben's overlapping holiday.
	assert.equal((await POST(createAbsence(ids.ben, start, end), ctx())).status, 200);
	const again = await POST(createAbsence(ids.anna, '2031-07-05T00:00:00.000Z', end), ctx());
	assert.equal(again.status, 409);
});

test('an absence of another WG is not listed', { skip }, async () => {
	const { POST, GET } = await import('../src/app/api/wg/[code]/absences/route.ts');
	await pool.query(
		`INSERT INTO public.member_absences (wg_id, member_id, start_date, end_date)
		 VALUES ($1, $2, '2032-03-01T00:00:00Z', '2032-03-10T00:00:00Z')`,
		[ids.wgB, ids.foreignMember],
	);
	caller.memberId = ids.anna;
	const ok = await POST(
		createAbsence(ids.anna, '2032-03-02T00:00:00.000Z', '2032-03-04T22:59:59.999Z'),
		ctx(),
	);
	assert.equal(ok.status, 200);
	const listed = (await (
		await GET(new NextRequest(`https://example.invalid/api/wg/${code}/absences`) as never, ctx())
	).json()) as { absences: { memberId: string }[] };
	assert.ok(listed.absences.length > 0);
	assert.ok(!listed.absences.some((a) => a.memberId === ids.foreignMember));
});

test('absences are listed by start date, earliest first', { skip }, async () => {
	const { GET } = await import('../src/app/api/wg/[code]/absences/route.ts');
	// The later absence is inserted first, so heap order differs from start-date order.
	await pool.query(
		`INSERT INTO public.member_absences (wg_id, member_id, start_date, end_date)
		 VALUES ($1, $2, '2034-05-01T00:00:00Z', '2034-05-05T00:00:00Z'),
		        ($1, $3, '2034-02-01T00:00:00Z', '2034-02-05T00:00:00Z')`,
		[ids.wgA, ids.anna, ids.ben],
	);
	const listed = (await (
		await GET(new NextRequest(`https://example.invalid/api/wg/${code}/absences`) as never, ctx())
	).json()) as { absences: { startDate: string }[] };
	const starts = listed.absences.map((a) => a.startDate.slice(0, 10)).filter((d) => d >= '2034');
	assert.deepEqual(starts, ['2034-02-01', '2034-05-01']);
});

test('an admin of another WG cannot cancel an occurrence of this WG series', { skip }, async () => {
	const { POST } = await import('../src/app/api/wg/[code]/events/[id]/occurrence/route.ts');
	const [event] = await rows<{ id: string }>(
		`INSERT INTO public.wg_events (wg_id, title, starts_at, recurrence, created_by_member_id)
		 VALUES ($1, 'Plenum', '2033-01-03T18:00:00Z', 'FREQ=WEEKLY', $2) RETURNING id`,
		[ids.wgB, ids.foreignMember],
	);
	const eventId = event?.id ?? '';
	// Anna is admin of WG A only; the series belongs to WG B.
	caller.memberId = ids.anna;
	const response = await POST(
		new NextRequest(`https://example.invalid/api/wg/${code}/events/${eventId}/occurrence`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'cancel', occurrenceStartsAt: '2033-01-10T18:00:00.000Z' }),
		}) as never,
		ctx({ id: eventId }),
	);
	assert.equal(response.status, 404);
	const [stored] = await rows<{ recurrence: string }>(
		'SELECT recurrence FROM public.wg_events WHERE id = $1',
		[eventId],
	);
	assert.equal(stored?.recurrence, 'FREQ=WEEKLY');
});
