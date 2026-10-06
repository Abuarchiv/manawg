// Balances and currency-scoped accounting: dashboard, debt list, reminders and notifications agree
// to the cent and never mix currencies.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { buildActivityTimeline } from '../src/composition/activity';
import { computeMemberBalances, summarizeDashboardSpend } from '../src/composition/dashboard-data';
import { getTodayImportantItems, getWgHealth } from '../src/composition/dashboard-insights';
import { formatNotificationMessage } from '../src/core/notifications/notifications';
import { computeNetBalances } from '../src/features/expenses/debt-reduction';
import { computeBalances, computeOldestDebtAges } from '../src/features/expenses/debts';
import { getDueRecurringExpenses } from '../src/features/expenses/recurring-expenses';
import { canSendReminder, formatReminderMessage } from '../src/features/expenses/reminders';
import { assertMatchObject } from './support/match-object';
import { tuple } from './support/values';

describe('dashboard balance consistency', () => {
	const memberA = '11111111-1111-4111-8111-111111111111';
	const memberB = '22222222-2222-4222-8222-222222222222';
	const memberC = '33333333-3333-4333-8333-333333333333';

	const members = [
		{ id: memberA, name: 'Anna', color: null },
		{ id: memberB, name: 'Ben', color: null },
		{ id: memberC, name: 'Cem', color: null },
	];

	type DashboardExpense = {
		id: string;
		paidByMemberId: string;
		amountCents: number;
	};

	type DashboardSplit = {
		expenseId: string;
		debtorMemberId: string;
		amountCents: number;
		settledAt: Date | null;
	};

	type Payment = {
		fromMemberId: string;
		toMemberId: string;
		amountCents: number;
		currency: string;
	};

	function expense(id: string, paidByMemberId: string, amountCents = 3_000): DashboardExpense {
		return { id, paidByMemberId, amountCents };
	}

	function split(
		expenseId: string,
		debtorMemberId: string,
		amountCents: number,
		settledAt: Date | null = null,
	): DashboardSplit {
		return { expenseId, debtorMemberId, amountCents, settledAt };
	}

	function dashboardBalances(
		expenses: DashboardExpense[],
		splits: DashboardSplit[],
		payments: Payment[] = [],
	) {
		return computeMemberBalances(members, expenses, splits, payments);
	}
	describe('Dashboard balance consistency', () => {
		test('matches expected balances for an unsettled three-person expense', () => {
			const currentExpense = expense('expense-unpaid', memberA);
			const actual = dashboardBalances(
				[currentExpense],
				[
					split(currentExpense.id, memberA, 1_000),
					split(currentExpense.id, memberB, 1_000),
					split(currentExpense.id, memberC, 1_000),
				],
			);

			assert.deepEqual(
				actual.map(({ paidCents, owedCents, balanceCents }) => ({
					paidCents,
					owedCents,
					balanceCents,
				})),
				[
					{ paidCents: 3_000, owedCents: 1_000, balanceCents: 2_000 },
					{ paidCents: 0, owedCents: 1_000, balanceCents: -1_000 },
					{ paidCents: 0, owedCents: 1_000, balanceCents: -1_000 },
				],
			);
		});

		test('matches expected balances for partial and full settlement', () => {
			const currentExpense = expense('expense-settlement', memberA);
			const splits = [
				split(currentExpense.id, memberA, 1_000),
				split(currentExpense.id, memberB, 1_000),
				split(currentExpense.id, memberC, 1_000),
			];

			const [splitA, splitB, splitC] = tuple(splits, 3);
			const partialSplits = [splitA, { ...splitB, settledAt: new Date() }, splitC];
			const partial = dashboardBalances([currentExpense], partialSplits);
			assert.deepEqual(
				partial.map(({ paidCents, owedCents, balanceCents }) => ({
					paidCents,
					owedCents,
					balanceCents,
				})),
				[
					{ paidCents: 3_000, owedCents: 1_000, balanceCents: 1_000 },
					{ paidCents: 0, owedCents: 0, balanceCents: 0 },
					{ paidCents: 0, owedCents: 1_000, balanceCents: -1_000 },
				],
			);
			const full = dashboardBalances(
				[currentExpense],
				splits.map((current) => ({ ...current, settledAt: new Date() })),
			);
			assert.deepEqual(
				full.map(({ paidCents, owedCents, balanceCents }) => ({
					paidCents,
					owedCents,
					balanceCents,
				})),
				[
					{ paidCents: 3_000, owedCents: 0, balanceCents: 0 },
					{ paidCents: 0, owedCents: 0, balanceCents: 0 },
					{ paidCents: 0, owedCents: 0, balanceCents: 0 },
				],
			);
		});

		test('keeps own shares neutral and applies completed provider transfers', () => {
			const ownExpense = expense('expense-own', memberA);
			const own = dashboardBalances([ownExpense], [split(ownExpense.id, memberA, 3_000)]);
			assert.deepEqual(
				own.map(({ paidCents, owedCents, balanceCents }) => ({
					paidCents,
					owedCents,
					balanceCents,
				})),
				[
					{ paidCents: 3_000, owedCents: 3_000, balanceCents: 0 },
					{ paidCents: 0, owedCents: 0, balanceCents: 0 },
					{ paidCents: 0, owedCents: 0, balanceCents: 0 },
				],
			);

			const sharedExpense = expense('expense-paid', memberA);
			const transferred = dashboardBalances(
				[sharedExpense],
				[
					split(sharedExpense.id, memberA, 1_000),
					split(sharedExpense.id, memberB, 1_000),
					split(sharedExpense.id, memberC, 1_000),
				],
				[{ fromMemberId: memberB, toMemberId: memberA, amountCents: 1_000, currency: 'EUR' }],
			);
			assert.deepEqual(
				transferred.map(({ paidCents, owedCents, balanceCents }) => ({
					paidCents,
					owedCents,
					balanceCents,
				})),
				[
					{ paidCents: 3_000, owedCents: 2_000, balanceCents: 1_000 },
					{ paidCents: 1_000, owedCents: 1_000, balanceCents: 0 },
					{ paidCents: 0, owedCents: 1_000, balanceCents: -1_000 },
				],
			);
		});
	});
});

describe('currency-scoped accounting', () => {
	const alice = '11111111-1111-4111-8111-111111111111';
	const ben = '22222222-2222-4222-8222-222222222222';
	const members = [
		{ id: alice, name: 'Alice', color: null },
		{ id: ben, name: 'Ben', color: null },
	];

	describe('audit #158 accounting invariants', () => {
		test('keeps balances and payments separate for each currency', () => {
			const expenses = [
				{
					paidByMemberId: alice,
					currency: 'EUR',
					occurredAt: '2026-01-01T12:00:00.000Z',
					splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
				},
				{
					paidByMemberId: alice,
					currency: 'CHF',
					occurredAt: '2026-01-02T12:00:00.000Z',
					splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
				},
			];
			const payments = [
				{ fromMemberId: ben, toMemberId: alice, amountCents: 1000, currency: 'EUR' },
			];

			assert.deepEqual(computeBalances(expenses, payments), [
				{ debtorId: ben, creditorId: alice, amountCents: 1000, currency: 'CHF' },
			]);
			assert.deepEqual(computeNetBalances(expenses, members, payments), [
				{ memberId: alice, memberName: 'Alice', color: null, cents: 1000, currency: 'CHF' },
				{ memberId: ben, memberName: 'Ben', color: null, cents: -1000, currency: 'CHF' },
				{ memberId: alice, memberName: 'Alice', color: null, cents: 0, currency: 'EUR' },
				{ memberId: ben, memberName: 'Ben', color: null, cents: 0, currency: 'EUR' },
			]);
		});

		test('nets opposite directions into one pair balance', () => {
			const expenses = [
				{
					paidByMemberId: alice,
					currency: 'EUR',
					occurredAt: '2026-01-01T12:00:00.000Z',
					splits: [{ debtorMemberId: ben, amountCents: 4295, settledAt: null }],
				},
				{
					paidByMemberId: ben,
					currency: 'EUR',
					occurredAt: '2026-01-02T12:00:00.000Z',
					splits: [{ debtorMemberId: alice, amountCents: 3852, settledAt: null }],
				},
			];
			assert.deepEqual(computeBalances(expenses), [
				{ debtorId: ben, creditorId: alice, amountCents: 443, currency: 'EUR' },
			]);
		});

		test('keeps dashboard gross balances in separate currency rows', () => {
			const expenses = [
				{ id: 'eur', paidByMemberId: alice, amountCents: 1000, currency: 'EUR' },
				{ id: 'chf', paidByMemberId: alice, amountCents: 1000, currency: 'CHF' },
			];
			const splits = [
				{ expenseId: 'eur', debtorMemberId: ben, amountCents: 1000, settledAt: null },
				{ expenseId: 'chf', debtorMemberId: ben, amountCents: 1000, settledAt: null },
			];

			assert.deepEqual(computeMemberBalances(members, expenses, splits), [
				{
					memberId: alice,
					memberName: 'Alice',
					color: null,
					currency: 'CHF',
					paidCents: 1000,
					owedCents: 0,
					balanceCents: 1000,
				},
				{
					memberId: ben,
					memberName: 'Ben',
					color: null,
					currency: 'CHF',
					paidCents: 0,
					owedCents: 1000,
					balanceCents: -1000,
				},
				{
					memberId: alice,
					memberName: 'Alice',
					color: null,
					currency: 'EUR',
					paidCents: 1000,
					owedCents: 0,
					balanceCents: 1000,
				},
				{
					memberId: ben,
					memberName: 'Ben',
					color: null,
					currency: 'EUR',
					paidCents: 0,
					owedCents: 1000,
					balanceCents: -1000,
				},
			]);
		});

		test('matches reminder ages by currency as well as member pair', () => {
			const expenses = [
				{
					paidByMemberId: alice,
					currency: 'EUR',
					occurredAt: '2026-01-01T12:00:00.000Z',
					splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
				},
				{
					paidByMemberId: alice,
					currency: 'CHF',
					occurredAt: '2026-01-10T12:00:00.000Z',
					splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
				},
			];
			const now = new Date('2026-01-11T12:00:00.000Z');

			assert.deepEqual(
				computeOldestDebtAges(
					[
						{ debtorId: ben, creditorId: alice, currency: 'EUR' },
						{ debtorId: ben, creditorId: alice, currency: 'CHF' },
					],
					expenses,
					now,
				),
				[10, 1],
			);
		});
	});

	describe('audit #158 currency consumers', () => {
		test('keeps dashboard spend totals and sparkline rows currency-scoped', () => {
			const summary = summarizeDashboardSpend(
				[
					{
						amountCents: 1000,
						currency: 'EUR',
						occurredAt: '2026-01-15T12:00:00.000Z',
					},
					{
						amountCents: 2500,
						currency: 'CHF',
						occurredAt: '2026-01-15T13:00:00.000Z',
					},
				],
				new Date('2026-01-15T14:00:00.000Z'),
			);

			assert.deepEqual(summary.totalSpendByCurrency, { EUR: 1000, CHF: 2500 });
			assert.deepEqual(summary.weekSpendByCurrency, { EUR: 1000, CHF: 2500 });
			assert.deepEqual(summary.monthSpendByCurrency, { EUR: 1000, CHF: 2500 });
			assert.equal(summary.totalSpendCents, null);
			for (const row of [
				{ date: '2026-01-15', currency: 'EUR', cents: 1000 },
				{ date: '2026-01-15', currency: 'CHF', cents: 2500 },
			]) {
				assert.ok(summary.spendByDay.some((day) => isDeepStrictEqual(day, row)));
			}
		});

		test('scopes reminder cooldown and copy by currency', () => {
			const now = new Date('2026-01-15T12:00:00.000Z');
			const history = [
				{
					debtorMemberId: ben,
					creditorMemberId: alice,
					currency: 'EUR',
					sentAt: '2026-01-15T10:00:00.000Z',
				},
			];

			assert.equal(canSendReminder(ben, alice, history, now, 'EUR').allowed, false);
			assert.equal(canSendReminder(ben, alice, history, now, 'CHF').allowed, true);
			assert.ok(
				formatReminderMessage({
					debtorName: 'Ben',
					creditorName: 'Alice',
					amountCents: 2500,
					currency: 'CHF',
					oldestDebtAgeDays: 2,
				}).includes('CHF'),
			);
		});

		test('keeps currency in activity, notifications, and health output', () => {
			const activity = buildActivityTimeline({
				members: members.map(({ id, name }) => ({ id, name })),
				expenses: [
					{
						id: 'expense-chf',
						paidByMemberId: alice,
						description: 'Miete',
						amountCents: 95000,
						currency: 'CHF',
						occurredAt: '2026-01-15T12:00:00.000Z',
					},
				],
				shoppingItems: [],
				announcements: [],
				choreCompletions: [],
			});
			assertMatchObject(activity[0], { amountCents: 95000, currency: 'CHF' });

			const notification = formatNotificationMessage('expense.created', {
				wgName: 'WG',
				actorName: 'Alice',
				title: 'Miete',
				amountCents: 95000,
				currency: 'CHF',
			});
			assert.ok(notification.body.includes('CHF'));
			assert.ok(
				formatNotificationMessage('expense.recurring_charged', {
					description: 'Internet',
					amountCents: 2500,
					currency: 'CHF',
				}).body.includes('CHF'),
			);

			const health = getWgHealth({
				shareCode: 'WGCODE01',
				openShoppingCount: 0,
				overdueChoreCount: 0,
				openDebtByCurrency: { EUR: 1000, CHF: 2500 },
				openAnnouncementCount: 0,
				absentMemberCount: 0,
				dueRecurringCount: 0,
			});
			assert.match(
				String(health.items.find((item) => item.label === 'Offene Schulden')?.value),
				/CHF/,
			);
		});

		test('preserves currency on recurring due items and today cards', () => {
			const due = getDueRecurringExpenses(
				[
					{
						id: 'recurring-chf',
						description: 'Internet',
						amountCents: 2500,
						currency: 'CHF',
						nextDueAt: '2026-01-14T12:00:00.000Z',
					},
				],
				new Date('2026-01-15T12:00:00.000Z').getTime(),
			);
			assert.equal(due[0]?.currency, 'CHF');

			const today = getTodayImportantItems({
				shareCode: 'WGCODE01',
				currentMemberId: alice,
				openShoppingCount: 0,
				openShoppingTop: [],
				dueChores: [],
				myOpenAnnouncements: [],
				dueRecurringExpenses: due,
				absentMembers: [],
				now: new Date('2026-01-15T12:00:00.000Z').getTime(),
			});
			assert.ok(today[0]?.detail?.includes('CHF'));
		});
	});
});
