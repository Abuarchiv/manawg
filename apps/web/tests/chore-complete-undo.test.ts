import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import pg from 'pg';

// Taking a completion back, against real rows: the compare-and-set on the chore, the ownership
// and time-window checks, the compensating audit event and the repeat call. Opt-in:
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

const code = 'CHU8PZAT';
const wg = { id: '' };
const caller = { memberId: '', name: 'Anna' };
mock.module('@/core/guards/require-wg-member', {
	namedExports: { requireWgMember: async () => ({ ok: true, wg, member: caller }) },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});

const pool = new pg.Pool({ connectionString: url || undefined, max: 3 });
const ids = { wg: '', anna: '', ben: '' };

const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
	(await pool.query(sql, params)).rows as T[];

const DAY = 86_400_000;

interface Completed {
	choreId: string;
	dueAt: Date;
	completionId: string;
	after: { nextDueAt: string; assignedMemberId: string | null };
	previous: { nextDueAt: string; assignedMemberId: string | null; anchorAt: string };
}

function ctx(extra: Record<string, string> = {}) {
	return { params: Promise.resolve({ code, ...extra }) } as never;
}

/** Completes a fresh chore of Anna's through the real route, as the client does. */
async function completeChore(title: string): Promise<Completed> {
	const { POST } = await import('../src/app/api/wg/[code]/chores/[id]/complete/route.ts');
	const dueAt = new Date(Date.now() + DAY);
	const [chore] = await rows<{ id: string }>(
		`INSERT INTO public.chores (wg_id, title, interval_days, assigned_member_id, next_due_at, anchor_at)
		 VALUES ($1, $2, 7, $3, $4, $4) RETURNING id`,
		[ids.wg, title, ids.anna, dueAt],
	);
	const choreId = chore?.id ?? '';
	const response = await POST(
		new NextRequest(`https://example.invalid/api/wg/${code}/chores/${choreId}/complete`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				expectedNextDueAt: dueAt.toISOString(),
				expectedAssignedMemberId: ids.anna,
			}),
		}) as never,
		ctx({ id: choreId }),
	);
	assert.equal(response.status, 200);
	const body = (await response.json()) as {
		chore: { nextDueAt: string; assignedMemberId: string | null };
		completion: { id: string; previous: Completed['previous'] };
	};
	return {
		choreId,
		dueAt,
		completionId: body.completion.id,
		previous: body.completion.previous,
		after: { nextDueAt: body.chore.nextDueAt, assignedMemberId: body.chore.assignedMemberId },
	};
}

async function undo(done: Completed, override: Record<string, unknown> = {}) {
	const { POST } = await import('../src/app/api/wg/[code]/chores/[id]/complete/undo/route.ts');
	return POST(
		new NextRequest(`https://example.invalid/api/wg/${code}/chores/${done.choreId}/complete/undo`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				completionId: done.completionId,
				previous: done.previous,
				expectedNextDueAt: done.after.nextDueAt,
				expectedAssignedMemberId: done.after.assignedMemberId,
				...override,
			}),
		}) as never,
		ctx({ id: done.choreId }),
	);
}

const choreRow = async (id: string) =>
	(
		await rows<{ next_due_at: Date; assigned_member_id: string | null; anchor_at: Date }>(
			'SELECT next_due_at, assigned_member_id, anchor_at FROM public.chores WHERE id = $1',
			[id],
		)
	)[0];
const completionCount = async (choreId: string) =>
	(await rows('SELECT 1 FROM public.chore_completions WHERE chore_id = $1', [choreId])).length;
const undoneAudits = async (choreId: string) =>
	rows<{ summary: string }>(
		`SELECT summary FROM public.audit_events WHERE entity_id = $1 AND event_type = 'chore.completion_undone'`,
		[choreId],
	);

before(async () => {
	if (skip) return;
	const suffix = randomUUID().replaceAll('-', '');
	const [wgRow] = await rows<{ id: string }>(
		'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
		[`U${suffix.slice(0, 7)}`, `Chore undo ${suffix}`],
	);
	ids.wg = wgRow?.id ?? '';
	const member = async (name: string) =>
		(
			await rows<{ id: string }>(
				'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
				[ids.wg, `${name} ${suffix}`],
			)
		)[0]?.id ?? '';
	ids.anna = await member('Anna');
	ids.ben = await member('Ben');
	wg.id = ids.wg;
	caller.memberId = ids.anna;
});

after(async () => {
	if (skip) return;
	await pool.query(
		'DELETE FROM public.chore_completions WHERE chore_id IN (SELECT id FROM public.chores WHERE wg_id = $1)',
		[ids.wg],
	);
	await pool.query('DELETE FROM public.audit_events WHERE wg_id = $1', [ids.wg]);
	await pool.query('DELETE FROM public.wgs WHERE id = $1', [ids.wg]);
	await pool.end();
});

test('undo restores the chore, removes the completion and records the audit event', {
	skip,
}, async () => {
	const done = await completeChore('Undo happy path');
	assert.equal(await completionCount(done.choreId), 1);
	assert.notEqual(done.after.nextDueAt, done.dueAt.toISOString(), 'the completion moved the chore');

	const response = await undo(done);
	assert.equal(response.status, 200);
	const stored = await choreRow(done.choreId);
	assert.equal(stored?.next_due_at.getTime(), done.dueAt.getTime());
	assert.equal(stored?.anchor_at.getTime(), done.dueAt.getTime());
	assert.equal(stored?.assigned_member_id, ids.anna);
	assert.equal(await completionCount(done.choreId), 0);
	const audits = await undoneAudits(done.choreId);
	assert.equal(audits.length, 1);
	assert.match(audits[0]?.summary ?? '', /Undo happy path/u);
});

test('a second undo of the same completion is a 409 and changes nothing', { skip }, async () => {
	const done = await completeChore('Undo twice');
	assert.equal((await undo(done)).status, 200);
	const again = await undo(done);
	assert.equal(again.status, 409);
	const stored = await choreRow(done.choreId);
	assert.equal(stored?.next_due_at.getTime(), done.dueAt.getTime());
	assert.equal((await undoneAudits(done.choreId)).length, 1);
});

test('a completion older than two minutes stays', { skip }, async () => {
	const done = await completeChore('Undo expired');
	await pool.query(
		`UPDATE public.chore_completions SET completed_at = now() - interval '3 minutes' WHERE id = $1`,
		[done.completionId],
	);
	const response = await undo(done);
	assert.equal(response.status, 409);
	assert.equal(await completionCount(done.choreId), 1);
	assert.equal((await choreRow(done.choreId))?.next_due_at.toISOString(), done.after.nextDueAt);
	assert.equal((await undoneAudits(done.choreId)).length, 0);
});

test('only the member who completed can undo', { skip }, async () => {
	const done = await completeChore('Undo wrong member');
	caller.memberId = ids.ben;
	try {
		const response = await undo(done);
		assert.equal(response.status, 403);
	} finally {
		caller.memberId = ids.anna;
	}
	assert.equal(await completionCount(done.choreId), 1);
	assert.equal((await choreRow(done.choreId))?.next_due_at.toISOString(), done.after.nextDueAt);
});

test('a chore that moved on is a 409: the compare-and-set keeps the new state', {
	skip,
}, async () => {
	const done = await completeChore('Undo conflict');
	const [moved] = await rows<{ next_due_at: Date }>(
		`UPDATE public.chores SET next_due_at = next_due_at + interval '1 day' WHERE id = $1 RETURNING next_due_at`,
		[done.choreId],
	);
	const response = await undo(done);
	assert.equal(response.status, 409);
	const stored = await choreRow(done.choreId);
	assert.equal(stored?.next_due_at.getTime(), moved?.next_due_at.getTime());
	assert.equal(stored?.assigned_member_id, done.after.assignedMemberId);
	assert.equal(await completionCount(done.choreId), 1);
	assert.equal((await undoneAudits(done.choreId)).length, 0);
});

test('an older completion cannot be undone once a newer one exists', { skip }, async () => {
	const done = await completeChore('Undo not latest');
	await pool.query(
		`INSERT INTO public.chore_completions (chore_id, completed_by_member_id, completed_at)
		 VALUES ($1, $2, now() + interval '1 second')`,
		[done.choreId, ids.ben],
	);
	assert.equal((await undo(done)).status, 409);
	assert.equal(await completionCount(done.choreId), 2);
});

test('a malformed body is a 400', { skip }, async () => {
	const done = await completeChore('Undo malformed');
	assert.equal((await undo(done, { completionId: 'nope' })).status, 400);
	assert.equal((await undo(done, { previous: null })).status, 400);
	assert.equal(await completionCount(done.choreId), 1);
});
