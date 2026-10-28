import {
	berlinDayKey,
	nextBerlinDayStart,
	prevBerlinDayStart,
	startOfBerlinDay,
} from '@/core/utils/berlin-day';
import { normalizeCurrency } from '@/core/utils/money';

const SPARKLINE_DAYS = 14;
const MONTH_DAYS = 30;

function addCurrencyTotal(totals: CurrencyTotals, currency: string, cents: number): void {
	totals[currency] = (totals[currency] ?? 0) + cents;
}

export interface DaySpend {
	date: string;
	currency: string;
	cents: number;
}

export type CurrencyTotals = Record<string, number>;

export interface DashboardSpendSummary {
	spendByDay: DaySpend[];
	totalSpendByCurrency: CurrencyTotals;
	weekSpendByCurrency: CurrencyTotals;
	monthSpendByCurrency: CurrencyTotals;
}

function berlinDaysAgoStart(todayStart: Date, daysAgo: number): Date {
	let day = todayStart;
	for (let i = 0; i < daysAgo; i++) day = prevBerlinDayStart(day);
	return day;
}

/** The oldest Berlin day the spend widgets look at; rows before it only feed the all-time total. */
export function dashboardSpendSince(now = new Date()): Date {
	return berlinDaysAgoStart(startOfBerlinDay(now), Math.max(SPARKLINE_DAYS - 1, MONTH_DAYS - 1));
}

/**
 * `expenses` only has to cover the days since `dashboardSpendSince(now)`; `allTimeTotals`
 * (per currency) replaces summing the whole history and defaults to the rows given.
 */
export function summarizeDashboardSpend(
	expenses: ReadonlyArray<{
		amountCents: number;
		currency?: string;
		occurredAt: Date | string;
	}>,
	now = new Date(),
	allTimeTotals?: ReadonlyArray<{ currency?: string; totalCents: number }>,
): DashboardSpendSummary {
	const todayStart = startOfBerlinDay(now);
	const sparklineStart = berlinDaysAgoStart(todayStart, SPARKLINE_DAYS - 1);
	const weekStart = berlinDaysAgoStart(todayStart, 6);
	const monthStart = berlinDaysAgoStart(todayStart, MONTH_DAYS - 1);
	const spendBuckets = new Map<string, CurrencyTotals>();
	let bucketDay = sparklineStart;
	for (let i = 0; i < SPARKLINE_DAYS; i++) {
		spendBuckets.set(berlinDayKey(bucketDay), {});
		bucketDay = nextBerlinDayStart(bucketDay);
	}
	const totalSpendByCurrency: CurrencyTotals = {};
	const weekSpendByCurrency: CurrencyTotals = {};
	const monthSpendByCurrency: CurrencyTotals = {};
	for (const total of allTimeTotals ?? []) {
		addCurrencyTotal(totalSpendByCurrency, normalizeCurrency(total.currency), total.totalCents);
	}
	for (const expense of expenses) {
		const currency = normalizeCurrency(expense.currency);
		if (!allTimeTotals) addCurrencyTotal(totalSpendByCurrency, currency, expense.amountCents);
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
	};
}
