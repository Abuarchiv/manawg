import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import pg from 'pg';
import { startOfBerlinDay } from '../src/core/utils/berlin-day.ts';
import { computeNextDueAt } from '../src/features/chores/chore-recurrence.ts';

// Chore SQL that mocked route tests cannot see: the WG scope of the chore list and of the chore
// lookup in the complete route, the monthly completion counts, and the rotation reading real
// members and absences (move-outs skipped, absence judged on the Berlin due day). Opt-in:
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

const code = 'CHR8PZAT';
const wg = { id: '' };
const caller = { memberId: '', name: 'Anna' };
mock.module('@/core/guards/require-wg-member', {
	namedExports: { requireWgMember: async () => ({ ok: true, wg, member: caller }) },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});

const pool = new pg.Pool({ connectionString: url || undefined, max: 3 });
const ids = { wgA: '', wgB: '', anna: '', ben: '', cem: '', dora: '', foreign: '' };

const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
	(await pool.query(sql, params)).rows as T[];

async function insertChore(
	wgId: string,
	title: string,
	assignedTo: string | null,
	nextDueAt: Date,
): Promise<string> {
	const [row] = await rows<{ id: string }>(
		`INSERT INTO public.chores (wg_id, title, interval_days, assigned_member_id, next_due_at, anchor_at)
		 VALUES ($1, $2, 7, $3, $4, $4) RETURNING id`,
		[wgId, title, assignedTo, nextDueAt],
	);
	return row?.id ?? '';
}

// Scores count every chore of the WG, so each rotation case starts from an empty chore table.
const clearChores = () => pool.query('DELETE FROM public.chores WHERE wg_id = $1', [ids.wgA]);

function ctx(extra: Record<string, string> = {}) {
	return { params: Promise.resolve({ code, ...extra }) } as never;
}

function complete(choreId: string, nextDueAt: Date, assignedMemberId: string | null): never {
	return new NextRequest(`https://example.invalid/api/wg/${code}/chores/${choreId}/complete`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			expectedNextDueAt: nextDueAt.toISOString(),
			expectedAssignedMemberId: assignedMemberId,
		}),
	}) as never;
}

const inAnHour = () => new Date(Date.now() + 3_600_000);

before(async () => {
	if (skip) return;
	const suffix = randomUUID().replaceAll('-', '');
	for (const key of ['wgA', 'wgB'] as const) {
		const [wgRow] = await rows<{ id: string }>(
			'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
			[`${key === 'wgA' ? 'A' : 'B'}${suffix.slice(0, 7)}`, `Chores ${key} ${suffix}`],
		);
		ids[key] = wgRow?.id ?? '';
	}
	// Created in this order: the rotation reads members by creation time.
	const member = async (wgId: string, name: string, deactivated = false) =>
		(
			await rows<{ id: string }>(
				`INSERT INTO public.wg_members (wg_id, name, deactivated_at)
				 VALUES ($1, $2, ${deactivated ? 'now()' : 'NULL'}) RETURNING id`,
				[wgId, `${name} ${suffix}`],
			)
		)[0]?.id ?? '';
	ids.anna = await member(ids.wgA, 'Anna');
	ids.ben = await member(ids.wgA, 'Ben', true);
	ids.cem = await member(ids.wgA, 'Cem');
	ids.dora = await member(ids.wgA, 'Dora');
	ids.foreign = await member(ids.wgB, 'Foreign');
	wg.id = ids.wgA;
	caller.memberId = ids.anna;
});

after(async () => {
	if (skip) return;
	await pool.query(
		'DELETE FROM public.chore_completions WHERE chore_id IN (SELECT id FROM public.chores WHERE wg_id = ANY($1))',
		[[ids.wgA, ids.wgB]],
	);
	await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [[ids.wgA, ids.wgB]]);
	await pool.end();
});

test('completing a chore of another WG is a 404 and changes nothing', { skip }, async () => {
	const { POST } = await import('../src/app/api/wg/[code]/chores/[id]/complete/route.ts');
	const dueAt = inAnHour();
	const foreign = await insertChore(ids.wgB, 'Foreign chore', ids.foreign, dueAt);
	const response = await POST(complete(foreign, dueAt, ids.foreign), ctx({ id: foreign }));
	assert.equal(response.status, 404);
	const [stored] = await rows<{ next_due_at: Date; assigned_member_id: string }>(
		'SELECT next_due_at, assigned_member_id FROM public.chores WHERE id = $1',
		[foreign],
	);
	assert.equal(stored?.next_due_at.getTime(), dueAt.getTime());
	assert.equal(stored?.assigned_member_id, ids.foreign);
	assert.equal(
		(await rows('SELECT 1 FROM public.chore_completions WHERE chore_id = $1', [foreign])).length,
		0,
	);
});

test('the chore list and the monthly counts cover the caller WG only', { skip }, async () => {
	const { GET } = await import('../src/app/api/wg/[code]/chores/route.ts');
	const own = await insertChore(ids.wgA, 'Own list chore', null, inAnHour());
	const foreign = await insertChore(ids.wgB, 'Foreign list chore', null, inAnHour());
	const complete_ = (choreId: string, memberId: string, completedAt: string) =>
		pool.query(
			`INSERT INTO public.chore_completions (chore_id, completed_by_member_id, completed_at)
			 VALUES ($1, $2, ${completedAt})`,
			[choreId, memberId],
		);
	await complete_(own, ids.cem, 'now()');
	await complete_(own, ids.dora, "now() - interval '90 days'");
	await complete_(foreign, ids.foreign, 'now()');

	const response = await GET(
		new NextRequest(`https://example.invalid/api/wg/${code}/chores`) as never,
		ctx(),
	);
	assert.equal(response.status, 200);
	const body = (await response.json()) as {
		chores: { id: string }[];
		monthCompletions: Record<string, number>;
	};
	const listed = body.chores.map((c) => c.id);
	assert.ok(listed.includes(own));
	assert.ok(!listed.includes(foreign), 'a chore of another WG is never listed');
	assert.equal(body.monthCompletions[ids.cem], 1);
	assert.equal(body.monthCompletions[ids.dora], undefined, 'last quarter is not this month');
	assert.equal(body.monthCompletions[ids.foreign], undefined, 'another WG is not counted');
});

test('the rotation skips a member who moved out and credits the caller', { skip }, async () => {
	const { POST } = await import('../src/app/api/wg/[code]/chores/[id]/complete/route.ts');
	await clearChores();
	const dueAt = inAnHour();
	const chore = await insertChore(ids.wgA, 'Rotation chore', ids.anna, dueAt);
	// Ben has the lowest score but moved out; Cem and Dora carry load so only the filter keeps
	// Ben from winning.
	await insertChore(ids.wgA, 'Cem load', ids.cem, dueAt);
	await insertChore(ids.wgA, 'Dora load', ids.dora, dueAt);
	await insertChore(ids.wgA, 'Dora load 2', ids.dora, dueAt);

	const response = await POST(complete(chore, dueAt, ids.anna), ctx({ id: chore }));
	assert.equal(response.status, 200);
	const [stored] = await rows<{ assigned_member_id: string }>(
		'SELECT assigned_member_id FROM public.chores WHERE id = $1',
		[chore],
	);
	assert.equal(stored?.assigned_member_id, ids.cem, 'neither the leaver nor nobody');
	const [completion] = await rows<{ completed_by_member_id: string }>(
		'SELECT completed_by_member_id FROM public.chore_completions WHERE chore_id = $1',
		[chore],
	);
	assert.equal(completion?.completed_by_member_id, ids.anna);
});

test('an absence that ends on the due day still counts on that day', { skip }, async () => {
	const { POST } = await import('../src/app/api/wg/[code]/chores/[id]/complete/route.ts');
	await clearChores();
	const dueAt = inAnHour();
	const chore = await insertChore(ids.wgA, 'Absence chore', ids.anna, dueAt);
	// Cem has no chore and would win; Dora carries one.
	await insertChore(ids.wgA, 'Dora absence load', ids.dora, dueAt);
	const nextDue = computeNextDueAt(dueAt, 7, new Date(), 'days', dueAt);
	const endsAtMidnight = startOfBerlinDay(nextDue);
	await pool.query(
		`INSERT INTO public.member_absences (wg_id, member_id, start_date, end_date)
		 VALUES ($1, $2, $3, $4)`,
		[ids.wgA, ids.cem, new Date(endsAtMidnight.getTime() - 3 * 86_400_000), endsAtMidnight],
	);

	const response = await POST(complete(chore, dueAt, ids.anna), ctx({ id: chore }));
	assert.equal(response.status, 200);
	const [stored] = await rows<{ assigned_member_id: string }>(
		'SELECT assigned_member_id FROM public.chores WHERE id = $1',
		[chore],
	);
	assert.equal(stored?.assigned_member_id, ids.dora, 'Cem is away on the due day');
});
