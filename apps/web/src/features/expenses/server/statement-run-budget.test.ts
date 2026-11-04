import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { ClaimedRow } from './statement-ledger';
import type { MailTransport } from './statement-transport';

process.env.MEMBER_SESSION_SECRET = 'test-secret';
const T0 = 1_800_000_000_000;
const MEMBER_ID = '00000000-0000-4000-8000-000000000001';
const wg = { id: 'wg', name: 'Kastanienallee', shareCode: 'KST4821X' };

let now = T0;
let loadDurationMs = 0;
let claimCalls = 0;
mock.method(Date, 'now', () => now);

const plan = {
	wg,
	plan: {
		recipients: [
			{
				memberId: MEMBER_ID,
				name: 'Mia',
				email: 'mia@example.org',
				statement: {
					monthKey: '2026-10',
					totalCents: 1000,
					items: [],
					categories: [],
					members: [{ id: MEMBER_ID, name: 'Mia', paidCents: 1000, shareCents: 500 }],
					open: [],
					transfers: [],
					settled: true,
					asOf: '2026-11-02T08:00:00Z',
				},
			},
		],
	},
};

mock.module('./statement-plans', {
	namedExports: {
		loadStatementPlans: async () => {
			now += loadDurationMs;
			return [plan];
		},
	},
});
mock.module('./statement-ledger', {
	namedExports: {
		CLAIM_BATCH_SIZE: 100,
		closeInterruptedRows: async () => 0,
		queueRows: async () => ({ queued: 1, skipped: 0 }),
		claimBatch: async (): Promise<ClaimedRow[]> => {
			claimCalls += 1;
			return claimCalls === 1 ? [{ id: 'row-1', memberId: MEMBER_ID, attempts: 1 }] : [];
		},
		recordOutcomes: async () => undefined,
	},
});
mock.module('./statement-pdf', {
	namedExports: {
		renderStatementPdf: async () => new Uint8Array([1]),
		statementPdfFilename: () => 'statement.pdf',
	},
});

const { runMonthlyStatements } = await import('./statement-run');

const deadlines: Array<number | undefined> = [];
const transport: MailTransport = {
	name: 'resend',
	async sendBatch(mails, deadline) {
		deadlines.push(deadline);
		return mails.map(() => ({ kind: 'sent' as const, providerId: 'p1' }));
	},
};

function reset(loadMs: number) {
	now = T0;
	loadDurationMs = loadMs;
	claimCalls = 0;
	deadlines.length = 0;
}

test('the send deadline counts from before the plans were loaded', async () => {
	reset(30_000);
	const summary = await runMonthlyStatements('2026-10', transport);
	assert.equal(summary.sent, 1);
	assert.equal(deadlines.length, 1);
	assert.ok(
		(deadlines[0] ?? Infinity) <= T0 + 40_000,
		`deadline ${deadlines[0]} is past T0 + 40 s`,
	);
});

test('a slow plan load leaves every row pending', async () => {
	reset(36_000);
	const summary = await runMonthlyStatements('2026-10', transport);
	assert.equal(claimCalls, 0);
	assert.equal(summary.sent, 0);
	assert.equal(summary.quotaReached, true);
});
