import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	LEAKED_SECRET,
	mockExportDb,
	resetExportDb,
} from '../../../../../../tests/support/export-db';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../tests/support/route-harness';
import { computeNetBalances } from '../../../../../features/expenses/debt-reduction';

const members = [
	{ id: 'alice', wgId: 'wg', name: 'Alice', createdAt: new Date('2026-01-01T00:00:00Z') },
	{ id: 'bob', wgId: 'wg', name: 'Bob', createdAt: new Date('2026-01-02T00:00:00Z') },
	{ id: 'carol', wgId: 'wg', name: 'Carol', createdAt: new Date('2026-01-03T00:00:00Z') },
];

const expenses = [
	{
		id: 'expense-eur',
		wgId: 'wg',
		description: 'EUR dinner',
		amountCents: 8000,
		currency: 'EUR',
		paidByMemberId: 'alice',
		imageUrl: null,
		occurredAt: new Date('2026-02-01T00:00:00Z'),
	},
	{
		id: 'expense-usd',
		wgId: 'wg',
		description: 'USD groceries',
		amountCents: 10000,
		currency: 'USD',
		paidByMemberId: 'carol',
		imageUrl: null,
		occurredAt: new Date('2026-02-02T00:00:00Z'),
	},
];

const splits = [
	{ expenseId: 'expense-eur', debtorMemberId: 'bob', amountCents: 4000, settledAt: null },
	{ expenseId: 'expense-usd', debtorMemberId: 'alice', amountCents: 5000, settledAt: null },
	{ expenseId: 'expense-usd', debtorMemberId: 'bob', amountCents: 5000, settledAt: null },
];

const completedPayments = [
	{
		id: 'payment-usd',
		wgId: 'wg',
		fromMemberId: 'alice',
		toMemberId: 'carol',
		amountCents: 2000,
		currency: 'USD',
		status: 'completed',
		completedAt: new Date('2026-02-04T12:00:00Z'),
	},
	{
		id: 'payment-eur',
		wgId: 'wg',
		fromMemberId: 'bob',
		toMemberId: 'alice',
		amountCents: 2500,
		currency: 'EUR',
		status: 'completed',
		completedAt: new Date('2026-02-03T12:00:00Z'),
	},
	{
		id: 'payment-pending',
		wgId: 'wg',
		fromMemberId: 'bob',
		toMemberId: 'alice',
		amountCents: 4000,
		currency: 'EUR',
		status: 'created',
		completedAt: null,
	},
];

const db = mockExportDb();
const observed = mockObservability();
mockRateLimit();
mockWgMember({
	wg: { id: 'wg', name: 'WG', shareCode: 'MTE8PZAT' },
	member: { memberId: 'alice', name: 'Alice' },
});

const { GET } = await import('./route');

function get(search = '', failedTable: 'expensePayments' | null = null) {
	resetExportDb(db, {
		applyConditions: true,
		failedTable,
		rowsByTable: { expensePayments: completedPayments, expenseSplits: splits, expenses, wgMembers: members },
	});
	return GET(request(`/api/wg/MTE8PZAT/export${search}`), routeCtx());
}

function appBalancesFromSource() {
	return computeNetBalances(
		expenses.map((expense) => ({
			paidByMemberId: expense.paidByMemberId,
			currency: expense.currency,
			splits: splits
				.filter((split) => split.expenseId === expense.id)
				.map(({ debtorMemberId, amountCents, settledAt }) => ({
					debtorMemberId,
					amountCents,
					settledAt,
				})),
		})),
		members.map(({ id, name }) => ({ id, name, color: null })),
		completedPayments
			.filter((payment) => payment.status === 'completed')
			.map(({ fromMemberId, toMemberId, amountCents, currency }) => ({
				fromMemberId,
				toMemberId,
				amountCents,
				currency,
			})),
	);
}

interface ExportedExpense {
	paidByMemberId: string;
	currency: string;
	splits: { debtorMemberId: string; amountCents: number; settledAt: string | null }[];
}

test('exported expenses and completed payments reconstruct the app balances by currency', async () => {
	const response = await get();
	assert.equal(response.status, 200);
	const exported = await response.json();

	assert.deepEqual(exported.sections.expensePayments, [
		{
			id: 'payment-usd',
			fromMemberId: 'alice',
			toMemberId: 'carol',
			amountCents: 2000,
			currency: 'USD',
			completedAt: '2026-02-04T12:00:00.000Z',
		},
		{
			id: 'payment-eur',
			fromMemberId: 'bob',
			toMemberId: 'alice',
			amountCents: 2500,
			currency: 'EUR',
			completedAt: '2026-02-03T12:00:00.000Z',
		},
	]);
	assert.equal(JSON.stringify(exported).includes(LEAKED_SECRET), false);
	assert.equal(JSON.stringify(exported).includes('providerOrderId'), false);
	assert.equal(JSON.stringify(exported).includes('payeeMerchantId'), false);
	assert.equal(exported.sections.expensePayments.length, 2);

	const exportedBalances = computeNetBalances(
		(exported.sections.expenses as ExportedExpense[]).map((expense) => ({
			paidByMemberId: expense.paidByMemberId,
			currency: expense.currency,
			splits: expense.splits.map((split) => ({
				...split,
				settledAt: split.settledAt === null ? null : new Date(split.settledAt),
			})),
		})),
		(exported.sections.members as { id: string; name: string }[]).map(({ id, name }) => ({
			id,
			name,
			color: null,
		})),
		exported.sections.expensePayments,
	);
	assert.deepEqual(exportedBalances, appBalancesFromSource());
	assert.deepEqual(
		exportedBalances.map(({ memberId, cents, currency }) => [memberId, cents, currency]),
		[
			['alice', 1500, 'EUR'],
			['bob', -1500, 'EUR'],
			['carol', 0, 'EUR'],
			['alice', -3000, 'USD'],
			['bob', -5000, 'USD'],
			['carol', 8000, 'USD'],
		],
	);
});

test('completed payments support optional JSON sections and paged CSV', async () => {
	const optionalResponse = await get('?sections=expensePayments');
	assert.equal(optionalResponse.status, 200);
	const optionalExport = await optionalResponse.json();
	assert.equal(optionalExport.sections.expensePayments.length, 2);
	assert.deepEqual(optionalExport.sections.expenses, []);
	assert.deepEqual(optionalExport.sections.members, []);

	const response = await get('?format=csv&section=expensePayments&limit=1&offset=1');
	assert.equal(response.status, 200);
	// Response.text() strips the BOM, so check the raw bytes for it.
	assert.deepEqual(
		[...new Uint8Array(await response.clone().arrayBuffer()).slice(0, 3)],
		[0xef, 0xbb, 0xbf],
	);
	assert.equal(
		await response.text(),
		'id;fromMemberId;toMemberId;amount;currency;completedAt\npayment-eur;bob;alice;25,00;EUR;2026-02-03T12:00:00.000Z',
	);
});

test('a failed completed payment query fails the full export closed', async () => {
	observed.logged = [];
	const response = await get('', 'expensePayments');
	assert.equal(response.status, 500);
	assert.deepEqual(await response.json(), { error: 'export_incomplete' });
	assert.equal(JSON.stringify(observed.logged).includes(LEAKED_SECRET), false);

	const csvResponse = await get('?format=csv&section=expensePayments', 'expensePayments');
	assert.equal(csvResponse.status, 500);
});
