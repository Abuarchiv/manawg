import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import pg from 'pg';

// Edit, pause and delete of a recurring template against real rows: the compare-and-set lives in
// the UPDATE's WHERE clause, so a second tab working from an older snapshot is only proven here.
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

async function setup() {
	const suffix = randomUUID().replaceAll('-', '');
	const [wg] = await q<{ id: string }>(
		'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
		[suffix.slice(0, 8).toUpperCase(), `Template ${suffix}`],
	);
	const wgId = wg?.id ?? '';
	wgIds.push(wgId);
	const [anna] = await q<{ id: string }>(
		'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
		[wgId, `Anna ${suffix}`],
	);
	const memberId = anna?.id ?? '';
	const due = new Date(Date.now() + 10 * 86_400_000);
	const [row] = await q<{ id: string }>(
		`INSERT INTO public.recurring_expenses
		   (wg_id, created_by_member_id, paid_by_member_id, description, amount_cents, interval_months,
		    next_due_at, anchor_at, splits_json)
		 VALUES ($1, $2, $2, 'Miete', 500, 1, $3, $3, $4) RETURNING id`,
		[wgId, memberId, due, JSON.stringify([{ debtorMemberId: memberId, amountCents: 500 }])],
	);
	const id = row?.id ?? '';
	const caller = { wgId, member: { memberId, name: 'Anna' } };
	return { wgId, id, caller };
}

async function load(id: string) {
	const { db, recurringExpenses } = await import('../src/core/db/index.ts');
	const { eq } = await import('drizzle-orm');
	const [row] = await db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id));
	assert.ok(row);
	return row;
}

const writes = () => import('../src/features/expenses/server/recurring-template-writes.ts');

const countAudit = async (wgId: string, eventType: string) =>
	(
		await q<{ n: number }>(
			'SELECT count(*)::int AS n FROM public.audit_events WHERE wg_id = $1 AND event_type = $2',
			[wgId, eventType],
		)
	)[0]?.n;

after(async () => {
	if (skip) return;
	if (wgIds.length) {
		await pool.query('DELETE FROM public.recurring_expenses WHERE wg_id = ANY($1)', [wgIds]);
		await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [wgIds]);
	}
	await pool.end();
});

test('a second tab pausing from the old snapshot gets the paused template, not a conflict', {
	skip,
}, async () => {
	const { editRecurringTemplate } = await writes();
	const { wgId, id, caller } = await setup();
	const snapshot = await load(id);

	const first = await editRecurringTemplate(caller, snapshot, { id, paused: true });
	assert.equal(first.status, 200);
	const second = await editRecurringTemplate(caller, snapshot, { id, paused: true });
	assert.equal(second.status, 200);
	const body = (await second.json()) as { recurringExpense: { pausedAt: string | null } };
	assert.notEqual(body.recurringExpense.pausedAt, null);
	assert.equal(await countAudit(wgId, 'recurring.paused'), 1);

	// Resuming twice from the paused snapshot is idempotent the same way.
	const paused = await load(id);
	assert.equal((await editRecurringTemplate(caller, paused, { id, paused: false })).status, 200);
	const again = await editRecurringTemplate(caller, paused, { id, paused: false });
	assert.equal(again.status, 200);
	const resumed = (await again.json()) as { recurringExpense: { pausedAt: string | null } };
	assert.equal(resumed.recurringExpense.pausedAt, null);
	assert.equal(await countAudit(wgId, 'recurring.resumed'), 1);
});

test('an edit from a snapshot another member already changed is a conflict', {
	skip,
}, async () => {
	const { editRecurringTemplate } = await writes();
	const { wgId, id, caller } = await setup();
	const snapshot = await load(id);

	assert.equal(
		(await editRecurringTemplate(caller, snapshot, { id, description: 'Strom' })).status,
		200,
	);
	const stale = await editRecurringTemplate(caller, snapshot, { id, description: 'Internet' });
	assert.equal(stale.status, 409);
	assert.equal((await load(id)).description, 'Strom');
	assert.equal(await countAudit(wgId, 'recurring.updated'), 1);

	// Saving the very value the other tab stored is no conflict.
	const same = await editRecurringTemplate(caller, snapshot, { id, description: 'Strom' });
	assert.equal(same.status, 200);
});

test('deleting a template removes it once; a second delete is not found', {
	skip,
}, async () => {
	const { deleteRecurringTemplate } = await writes();
	const { wgId, id, caller } = await setup();

	assert.equal((await deleteRecurringTemplate(caller, id)).status, 200);
	assert.equal((await q('SELECT 1 FROM public.recurring_expenses WHERE id = $1', [id])).length, 0);
	assert.equal(await countAudit(wgId, 'recurring.deleted'), 1);
	assert.equal((await deleteRecurringTemplate(caller, id)).status, 404);

	// Another flat cannot reach the template by id.
	const other = await setup();
	assert.equal((await deleteRecurringTemplate(caller, other.id)).status, 404);
	assert.equal(
		(await q('SELECT 1 FROM public.recurring_expenses WHERE id = $1', [other.id])).length,
		1,
	);
});
