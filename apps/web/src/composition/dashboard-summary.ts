/** Pure money summaries for the dashboard: spend per Berlin day and per-member balances. */
import {
	berlinDayKey,
	nextBerlinDayStart,
	prevBerlinDayStart,
	startOfBerlinDay,
} from '@/core/utils/berlin-day';
import { normalizeCurrency } from '@/core/utils/money';
import { type ExpensePaymentInput, computeNetBalances } from '@/features/expenses/debt-reduction';

const SPARKLINE_DAYS = 14;

export type CurrencyTotals = Record<string, number>;

export interface DaySpend {
	date: string;
	currency: string;
	cents: number;
}

export interface MemberBalance {
	memberId: string;
	memberName: string;
	color: string | null;
	currency: string;
	paidCents: number;
	owedCents: number;
	balanceCents: number;
}

export interface DashboardSpendSummary {
	spendByDay: DaySpend[];
	totalSpendByCurrency: CurrencyTotals;
	weekSpendByCurrency: CurrencyTotals;
	monthSpendByCurrency: CurrencyTotals;
	totalSpendCents: number | null;
	weekSpendCents: number | null;
	monthSpendCents: number | null;
}

export function addCurrencyTotal(totals: CurrencyTotals, currency: string, cents: number): void {
	totals[currency] = (totals[currency] ?? 0) + cents;
}

export function singleCurrencyTotal(totals: Readonly<CurrencyTotals>): number | null {
	const currencies = Object.keys(totals).filter((currency) => totals[currency] !== 0);
	return currencies.length <= 1 ? (currencies[0] ? (totals[currencies[0]] ?? 0) : 0) : null;
}

function berlinDaysAgoStart(todayStart: Date, daysAgo: number): Date {
	let day = todayStart;
	for (let i = 0; i < daysAgo; i++) day = prevBerlinDayStart(day);
	return day;
}

export function summarizeDashboardSpend(
	expenses: ReadonlyArray<{
		amountCents: number;
		currency?: string;
		occurredAt: Date | string;
	}>,
	now = new Date(),
): DashboardSpendSummary {
	const todayStart = startOfBerlinDay(now);
	const sparklineStart = berlinDaysAgoStart(todayStart, SPARKLINE_DAYS - 1);
	const weekStart = berlinDaysAgoStart(todayStart, 6);
	const monthStart = berlinDaysAgoStart(todayStart, 29);
	const spendBuckets = new Map<string, CurrencyTotals>();
	let bucketDay = sparklineStart;
	for (let i = 0; i < SPARKLINE_DAYS; i++) {
		spendBuckets.set(berlinDayKey(bucketDay), {});
		bucketDay = nextBerlinDayStart(bucketDay);
	}
	const totalSpendByCurrency: CurrencyTotals = {};
	const weekSpendByCurrency: CurrencyTotals = {};
	const monthSpendByCurrency: CurrencyTotals = {};
	for (const expense of expenses) {
		const currency = normalizeCurrency(expense.currency);
		addCurrencyTotal(totalSpendByCurrency, currency, expense.amountCents);
		const occurredAt =
			expense.occurredAt instanceof Date ? expense.occurredAt : new Date(expense.occurredAt);
		if (occurredAt >= weekStart)
			addCurrencyTotal(weekSpendByCurrency, currency, expense.amountCents);
		if (occurredAt >= monthStart)
			addCurrencyTotal(monthSpendByCurrency, currency, expense.amountCents);
		const bucket = spendBuckets.get(berlinDayKey(occurredAt));
		if (bucket) addCurrencyTotal(bucket, currency, expense.amountCents);
	}
	const spendByDay: DaySpend[] = Array.from(spendBuckets.entries()).flatMap(([date, totals]) => {
		const entries = Object.entries(totals).sort(([left], [right]) => left.localeCompare(right));
		return entries.length > 0
			? entries.map(([currency, cents]) => ({ date, currency, cents }))
			: [{ date, currency: 'EUR', cents: 0 }];
	});
	return {
		spendByDay,
		totalSpendByCurrency,
		weekSpendByCurrency,
		monthSpendByCurrency,
		totalSpendCents: singleCurrencyTotal(totalSpendByCurrency),
		weekSpendCents: singleCurrencyTotal(weekSpendByCurrency),
		monthSpendCents: singleCurrencyTotal(monthSpendByCurrency),
	};
}

export function computeMemberBalances(
	members: Array<{ id: string; name: string; color: string | null }>,
	expenses: Array<{
		id: string;
		paidByMemberId: string;
		amountCents: number;
		currency?: string;
	}>,
	splits: Array<{
		expenseId: string;
		debtorMemberId: string;
		amountCents: number;
		settledAt: Date | null;
	}>,
	payments: ExpensePaymentInput[] = [],
): MemberBalance[] {
	const splitsByExpense = new Map<
		string,
		Array<{ debtorMemberId: string; amountCents: number; settledAt: string | null }>
	>();
	for (const split of splits) {
		const expenseSplits = splitsByExpense.get(split.expenseId) ?? [];
		expenseSplits.push({
			debtorMemberId: split.debtorMemberId,
			amountCents: split.amountCents,
			settledAt: split.settledAt?.toISOString() ?? null,
		});
		splitsByExpense.set(split.expenseId, expenseSplits);
	}

	const normalizedExpenses = expenses.map((expense) => ({
		...expense,
		currency: normalizeCurrency(expense.currency),
	}));
	const netBalances = computeNetBalances(
		normalizedExpenses.map((expense) => ({
			paidByMemberId: expense.paidByMemberId,
			currency: expense.currency,
			splits: splitsByExpense.get(expense.id) ?? [],
		})),
		members,
		payments,
	);
	const grossByKey = new Map<string, { paidCents: number; owedCents: number }>();
	const currencies = new Set<string>(netBalances.map((balance) => balance.currency));
	for (const expense of normalizedExpenses) {
		currencies.add(expense.currency);
		const key = `${expense.currency}:${expense.paidByMemberId}`;
		const paid = grossByKey.get(key) ?? { paidCents: 0, owedCents: 0 };
		paid.paidCents += expense.amountCents;
		grossByKey.set(key, paid);
	}
	const currencyByExpenseId = new Map(
		normalizedExpenses.map((expense) => [expense.id, expense.currency]),
	);
	for (const split of splits) {
		if (split.settledAt) continue;
		const currency = currencyByExpenseId.get(split.expenseId) ?? 'EUR';
		const key = `${currency}:${split.debtorMemberId}`;
		const owed = grossByKey.get(key) ?? { paidCents: 0, owedCents: 0 };
		owed.owedCents += split.amountCents;
		grossByKey.set(key, owed);
	}
	for (const payment of payments) {
		const currency = payment.currency?.trim().toUpperCase() || 'EUR';
		currencies.add(currency);
		const paidKey = `${currency}:${payment.fromMemberId}`;
		const owedKey = `${currency}:${payment.toMemberId}`;
		const paid = grossByKey.get(paidKey) ?? { paidCents: 0, owedCents: 0 };
		const owed = grossByKey.get(owedKey) ?? { paidCents: 0, owedCents: 0 };
		paid.paidCents += payment.amountCents;
		owed.owedCents += payment.amountCents;
		grossByKey.set(paidKey, paid);
		grossByKey.set(owedKey, owed);
	}

	return [...currencies].sort().flatMap((currency) =>
		members.map((member) => {
			const net = netBalances.find(
				(balance) => balance.memberId === member.id && balance.currency === currency,
			);
			const gross = grossByKey.get(`${currency}:${member.id}`);
			return {
				memberId: member.id,
				memberName: member.name,
				color: member.color,
				currency,
				paidCents: gross?.paidCents ?? 0,
				owedCents: gross?.owedCents ?? 0,
				balanceCents: net?.cents ?? 0,
			};
		}),
	);
}
