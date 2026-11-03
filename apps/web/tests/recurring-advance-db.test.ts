import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import pg from 'pg';

// The recurring-advance cron against real rows. The route test fakes the database, so the guards
// that live in SQL (moved-out members, booking date, ledger columns, audit row, notification per
// booking) are only proven here. Opt-in: TEST_DATABASE_URL must name a disposable loopback
// database with all migrations applied (`pnpm test:db`).
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

const notified: { event: string; wgId: string }[] = [];
mock.module('@/core/infra/cron-auth', { namedExports: { requireCronSecret: () => null } });
mock.module('@/core/infra/cron-monitor', {
	namedExports: { monitorCron: (_slug: string, _schedule: string, run: () => unknown) => run() },
});
mock.module('@/core/infra/observability', {
	namedExports: {
		withCronLogging: (_name: string, handler: unknown) => handler,
		logApiError: () => undefined,
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async (input: { event: string; wg: { id: string } }) => {
			notified.push({ event: input.event, wgId: input.wg.id });
			return { warning: null };
		},
	},
});

const pool = new pg.Pool({ connectionString: url || undefined, max: 3 });
const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
	(await pool.query(sql, params)).rows as T[];
const wgIds: string[] = [];

async function newWg() {
	const suffix = randomUUID().replaceAll('-', '');
	const [wg] = await q<{ id: string }>(
		'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
		[suffix.slice(0, 8).toUpperCase(), `Recurring ${suffix}`],
	);
	const wgId = wg?.id ?? '';
	wgIds.push(wgId);
	const member = async (name: string, deactivated: boolean) =>
		(
			await q<{ id: string }>(
				`INSERT INTO public.wg_members (wg_id, name, deactivated_at)
				 VALUES ($1, $2, ${deactivated ? 'now()' : 'NULL'}) RETURNING id`,
				[wgId, `${name} ${suffix}`],
			)
		)[0]?.id ?? '';
	return { wgId, member };
}

async function newTemplate(
	wgId: string,
	paidBy: string,
	debtors: string[],
	dueAt: Date,
	pausedAt: Date | null = null,
) {
	const each = 500 / debtors.length;
	const splits = debtors.map((debtorMemberId) => ({ debtorMemberId, amountCents: each }));
	const [row] = await q<{ id: string }>(
		`INSERT INTO public.recurring_expenses
		   (wg_id, created_by_member_id, paid_by_member_id, description, amount_cents, interval_months,
		    next_due_at, anchor_at, splits_json, paused_at)
		 VALUES ($1, $2, $2, 'Miete', 500, 1, $3, $3, $4, $5) RETURNING id`,
		[wgId, paidBy, dueAt, JSON.stringify(splits), pausedAt],
	);
	return row?.id ?? '';
}

const monthStart = (offset: number) => {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
};

async function run() {
	const { GET } = await import('../src/app/api/cron/recurring-advance/route.ts');
	const response = await GET(
		new Request('https://example.invalid/api/cron/recurring-advance') as never,
	);
	return { status: response.status, body: (await response.json()) as { charged: number } };
}

const countBooked = async (templateId: string) =>
	(
		await q<{ n: number }>(
			'SELECT count(*)::int AS n FROM public.expenses WHERE recurring_expense_id = $1',
			[templateId],
		)
	)[0]?.n;

const countAudit = async (wgId: string, eventType: string) =>
	(
		await q<{ n: number }>(
			'SELECT count(*)::int AS n FROM public.audit_events WHERE wg_id = $1 AND event_type = $2',
			[wgId, eventType],
		)
	)[0]?.n;

before(() => {
	notified.length = 0;
});

after(async () => {
	if (skip) return;
	if (wgIds.length) {
		await pool.query('DELETE FROM public.recurring_expenses WHERE wg_id = ANY($1)', [wgIds]);
		await pool.query('DELETE FROM public.expenses WHERE wg_id = ANY($1)', [wgIds]);
		await pool.query('DELETE FROM public.wgs WHERE id = ANY($1)', [wgIds]);
	}
	await pool.end();
});

test('a due template books every missed month on its due date and advances once', {
	skip,
}, async () => {
	const { wgId, member } = await newWg();
	const anna = await member('Anna', false);
	const ben = await member('Ben', false);
	const id = await newTemplate(wgId, anna, [anna, ben], monthStart(-2));

	const result = await run();
	assert.equal(result.status, 200);

	const booked = await q<{ occurred_at: Date; recurring_due_at: Date; paid_by_member_id: string }>(
		`SELECT occurred_at, recurring_due_at, paid_by_member_id FROM public.expenses
		 WHERE recurring_expense_id = $1 ORDER BY recurring_due_at`,
		[id],
	);
	assert.deepEqual(
		booked.map((row) => row.recurring_due_at.toISOString()),
		[monthStart(-2), monthStart(-1), monthStart(0)].map((date) => date.toISOString()),
	);
	// A booking carries its due date, not the day the cron happened to run.
	assert.deepEqual(
		booked.map((row) => row.occurred_at.toISOString()),
		booked.map((row) => row.recurring_due_at.toISOString()),
	);
	assert.ok(booked.every((row) => row.paid_by_member_id === anna));

	const [template] = await q<{ next_due_at: Date; last_created_at: Date | null }>(
		'SELECT next_due_at, last_created_at FROM public.recurring_expenses WHERE id = $1',
		[id],
	);
	assert.equal(template?.next_due_at.toISOString(), monthStart(1).toISOString());
	assert.ok(template?.last_created_at, 'the template remembers when it last booked');

	const splits = await q<{ n: number }>(
		`SELECT count(*)::int AS n FROM public.expense_splits s JOIN public.expenses e ON e.id = s.expense_id
		 WHERE e.recurring_expense_id = $1`,
		[id],
	);
	assert.equal(splits[0]?.n, 6);

	// Every booking is announced in the WG feed and by a notification.
	assert.equal(await countAudit(wgId, 'recurring.charged'), 3);
	assert.equal(
		notified.filter((n) => n.wgId === wgId && n.event === 'expense.recurring_charged').length,
		3,
	);

	// A second run finds nothing due and books nothing again.
	await run();
	assert.equal(await countBooked(id), 3);
	assert.equal(await countAudit(wgId, 'recurring.charged'), 3);
});

test('a template whose debtor moved out is paused, not booked, and the WG is told', {
	skip,
}, async () => {
	const { wgId, member } = await newWg();
	const anna = await member('Anna', false);
	const gone = await member('Gone', true);
	const due = monthStart(-1);
	const id = await newTemplate(wgId, anna, [anna, gone], due);

	await run();

	assert.equal(await countBooked(id), 0);
	const [template] = await q<{ paused_at: Date | null; next_due_at: Date }>(
		'SELECT paused_at, next_due_at FROM public.recurring_expenses WHERE id = $1',
		[id],
	);
	assert.ok(template?.paused_at, 'the template is paused');
	assert.equal(template?.next_due_at.toISOString(), due.toISOString());
	assert.equal(await countAudit(wgId, 'recurring.auto_paused'), 1);
	assert.equal(await countAudit(wgId, 'recurring.charged'), 0);
});

test('a template whose payer moved out is paused and not booked', { skip }, async () => {
	const { wgId, member } = await newWg();
	const anna = await member('Anna', false);
	const gone = await member('Gone', true);
	const id = await newTemplate(wgId, gone, [anna], monthStart(-1));

	await run();

	assert.equal(await countBooked(id), 0);
	const [template] = await q<{ paused_at: Date | null }>(
		'SELECT paused_at FROM public.recurring_expenses WHERE id = $1',
		[id],
	);
	assert.ok(template?.paused_at);
	assert.equal(await countAudit(wgId, 'recurring.auto_paused'), 1);
});

test('a paused template is never booked', { skip }, async () => {
	const { wgId, member } = await newWg();
	const anna = await member('Anna', false);
	const id = await newTemplate(wgId, anna, [anna], monthStart(-1), new Date());

	await run();

	assert.equal(await countBooked(id), 0);
	assert.equal(await countAudit(wgId, 'recurring.charged'), 0);
});
