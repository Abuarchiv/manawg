import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';

const runs: string[] = [];
mock.module('@/core/infra/cron-auth', { namedExports: { requireCronSecret: () => null } });
mock.module('@/core/infra/observability', {
	namedExports: { withCronLogging: (_name: string, handler: unknown) => handler },
});
mock.module('@/features/expenses/server/statement-transport', {
	namedExports: { createStatementTransport: () => ({}) },
});
mock.module('@/features/expenses/server/statement-run', {
	namedExports: {
		runMonthlyStatements: async (monthKey: string) => {
			runs.push(monthKey);
			return { monthKey };
		},
	},
});
const { GET } = await import('./route');

async function call(at: string, query = '') {
	mock.timers.enable({ apis: ['Date'], now: new Date(at) });
	runs.length = 0;
	try {
		const res = await GET(new NextRequest(`http://localhost/api/cron/monthly-statements${query}`));
		return { status: res.status, body: await res.json() };
	} finally {
		mock.timers.reset();
	}
}

test('on the 1st (Berlin) it mails the finished previous month', async () => {
	// 2026-10-31T23:30Z is already 1 November 00:30 in Berlin
	const res = await call('2026-10-31T23:30:00.000Z');
	assert.equal(res.status, 200);
	assert.deepEqual(runs, ['2026-10']);
});

test('across the year boundary it mails December', async () => {
	await call('2027-01-01T08:00:00.000Z');
	assert.deepEqual(runs, ['2026-12']);
});

test('the retry window ends after day 5 (Berlin), and day 5 still sends', async () => {
	assert.equal((await call('2026-11-05T23:30:00.000Z')).body.skipped, 'outside_send_window'); // 6 Nov 00:30 Berlin
	assert.equal((await call('2026-11-05T12:00:00.000Z')).status, 200);
	assert.deepEqual(runs, ['2026-10']);
});

test('the current month is never mailed', async () => {
	const res = await call('2026-11-02T08:00:00.000Z', '?month=2026-11');
	assert.equal(res.status, 400);
	assert.equal(res.body.error, 'month_not_finished');
	assert.deepEqual(runs, []);
});
