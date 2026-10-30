import { normalizeCurrency } from '@/core/utils/money';
import { MS_PER_DAY } from '@/core/utils/time';
import type { ExpensePaymentInput } from './expense-payment-input';

export interface PairExpenseInput {
	paidByMemberId: string;
	currency?: string;
	splits: Array<{
		debtorMemberId: string;
		amountCents: number;
		settledAt: string | null;
	}>;
}

export interface DebtExpenseInput extends PairExpenseInput {
	occurredAt: string;
}

export interface PairBalance {
	creditorId: string;
	debtorId: string;
	amountCents: number;
	currency: string;
}

/**
 * Pair maths without netting: aggregate unsettled splits per
 * (debtor, creditor) pair, subtract payments, flip a negative residual into its
 * reverse pair. Netting and cycle cancellation are deliberately left out —
 * `computeBalances` adds them, `computeDirectDebts` must not.
 */
export function aggregatePairTotals(
	expenses: ReadonlyArray<PairExpenseInput>,
	payments: ReadonlyArray<ExpensePaymentInput> = [],
): Map<string, PairBalance> {
	const totals = new Map<string, PairBalance>();

	for (const expense of expenses) {
		const creditorId = expense.paidByMemberId;
		for (const split of expense.splits) {
			if (split.settledAt !== null) continue;
			if (split.debtorMemberId === creditorId) continue;
			if (split.amountCents <= 0) continue;

			const currency = normalizeCurrency(expense.currency);
			const key = `${currency}:${split.debtorMemberId}:${creditorId}`;
			const current = totals.get(key);
			if (current) {
				totals.set(key, { ...current, amountCents: current.amountCents + split.amountCents });
			} else {
				totals.set(key, {
					creditorId,
					debtorId: split.debtorMemberId,
					amountCents: split.amountCents,
					currency,
				});
			}
		}
	}
	for (const payment of payments) {
		if (payment.amountCents <= 0 || payment.fromMemberId === payment.toMemberId) continue;
		const currency = normalizeCurrency(payment.currency);
		const key = `${currency}:${payment.fromMemberId}:${payment.toMemberId}`;
		const current = totals.get(key);
		if (current) {
			current.amountCents -= payment.amountCents;
		} else {
			totals.set(key, {
				creditorId: payment.toMemberId,
				debtorId: payment.fromMemberId,
				amountCents: -payment.amountCents,
				currency,
			});
		}
	}
	for (const pair of totals.values()) {
		if (pair.amountCents >= 0) continue;
		const key = `${pair.currency}:${pair.creditorId}:${pair.debtorId}`;
		const reverse = totals.get(key);
		if (reverse) {
			reverse.amountCents -= pair.amountCents;
		} else {
			totals.set(key, {
				creditorId: pair.debtorId,
				debtorId: pair.creditorId,
				amountCents: -pair.amountCents,
				currency: pair.currency,
			});
		}
		pair.amountCents = 0;
	}
	return totals;
}

/**
 * Aggregate unsettled debts per (debtor, creditor) pair.
 *
 * The result is reduced — if Alice paid for Ben twice (10€ + 5€) and Ben never
 * paid Alice back, we return a single { debtor: Ben, creditor: Alice, 15€ } row.
 * Pairs with zero balance are omitted.
 */
export function computeBalances(
	expenses: ReadonlyArray<DebtExpenseInput>,
	payments: ReadonlyArray<ExpensePaymentInput> = [],
): PairBalance[] {
	const totals = aggregatePairTotals(expenses, payments);

	// Net opposite directions per pair: A owes B 42,95 € and B owes A 38,52 €
	// is a single 4,43 € debt from A to B, never two remindable rows.
	for (const pair of totals.values()) {
		const reverse = totals.get(`${pair.currency}:${pair.creditorId}:${pair.debtorId}`);
		if (!reverse || pair.amountCents <= 0 || reverse.amountCents <= 0) continue;
		const offset = Math.min(pair.amountCents, reverse.amountCents);
		pair.amountCents -= offset;
		reverse.amountCents -= offset;
	}

	cancelDebtCycles(totals);
	return Array.from(totals.values()).filter((pair) => pair.amountCents > 0);
}

/** The debts that lead from `from` to `to`, shortest chain first, or null when none does. */
function findDebtChain(
	totals: ReadonlyMap<string, PairBalance>,
	currency: string,
	from: string,
	to: string,
): PairBalance[] | null {
	const reached = new Map<string, PairBalance[]>([[from, []]]);
	const queue = [from];
	for (let head = 0; head < queue.length; head += 1) {
		const node = queue[head] as string;
		const chain = reached.get(node) as PairBalance[];
		// Sorted by member id: row order in the database must not decide which chain is shown.
		const outgoing = Array.from(totals.values())
			.filter(
				(pair) => pair.currency === currency && pair.amountCents > 0 && pair.debtorId === node,
			)
			.sort((a, b) => a.creditorId.localeCompare(b.creditorId));
		for (const pair of outgoing) {
			if (reached.has(pair.creditorId)) continue;
			const next = [...chain, pair];
			if (pair.creditorId === to) return next;
			reached.set(pair.creditorId, next);
			queue.push(pair.creditorId);
		}
	}
	return null;
}

/**
 * Debts that lead in a circle (A owes B, B owes C, C owes A) cancel out by the smallest amount
 * on the circle, whether the circle comes from expenses or from a payment between two members
 * who owe each other only through a third one (A owes B, B owes C, A pays C).
 */
function cancelDebtCycles(totals: Map<string, PairBalance>): void {
	for (const key of [...totals.keys()].sort()) {
		for (;;) {
			const edge = totals.get(key);
			if (!edge || edge.amountCents <= 0) break;
			const chain = findDebtChain(totals, edge.currency, edge.creditorId, edge.debtorId);
			if (!chain) break;
			const covered = Math.min(edge.amountCents, ...chain.map((pair) => pair.amountCents));
			edge.amountCents -= covered;
			for (const pair of chain) pair.amountCents -= covered;
		}
	}
}

/**
 * Age (in whole days) of the oldest unsettled split between two members.
 *
 * Renders the "seit X Tagen" copy in reminders. Direction matters: the debtor
 * owes the creditor, so only splits where the creditor paid and the
 * debtor is the listed debtor count.
 */
export function computeOldestDebtAgeDays(
	debtorId: string,
	creditorId: string,
	expenses: ReadonlyArray<DebtExpenseInput>,
	now: Date = new Date(),
	currency?: string,
	payments: ReadonlyArray<ExpensePaymentInput> = [],
): number {
	const currencies =
		currency === undefined
			? new Set(expenses.map((expense) => normalizeCurrency(expense.currency)))
			: new Set([normalizeCurrency(currency)]);
	const ages = computeOldestDebtAges(
		[...currencies].map((code) => ({ debtorId, creditorId, currency: code })),
		expenses,
		now,
		payments,
	);
	return Math.max(0, ...ages);
}

/**
 * Batch form of `computeOldestDebtAgeDays` for rendering a whole balances
 * list: a single pass over `expenses` collects the unsettled splits of every
 * (debtor, creditor) pair. Payments from the debtor to the creditor pay off
 * that pair's splits oldest first (they never set `settledAt`), so a paid
 * old debt does not date the reminder. Returns ages in the same order as
 * `pairs`.
 */
export function computeOldestDebtAges(
	pairs: ReadonlyArray<{ debtorId: string; creditorId: string; currency?: string }>,
	expenses: ReadonlyArray<DebtExpenseInput>,
	now: Date = new Date(),
	payments: ReadonlyArray<ExpensePaymentInput> = [],
): number[] {
	const splitsByPair = new Map<string, Array<{ ts: number; cents: number }>>();
	for (const expense of expenses) {
		const ts = Date.parse(expense.occurredAt);
		if (Number.isNaN(ts)) continue;
		const currency = normalizeCurrency(expense.currency);
		for (const split of expense.splits) {
			if (split.settledAt !== null) continue;
			if (split.amountCents <= 0) continue;
			const key = `${currency}:${split.debtorMemberId}:${expense.paidByMemberId}`;
			const list = splitsByPair.get(key) ?? [];
			list.push({ ts, cents: split.amountCents });
			splitsByPair.set(key, list);
		}
	}
	const paidByPair = new Map<string, number>();
	for (const payment of payments) {
		if (payment.amountCents <= 0) continue;
		const key = `${normalizeCurrency(payment.currency)}:${payment.fromMemberId}:${payment.toMemberId}`;
		paidByPair.set(key, (paidByPair.get(key) ?? 0) + payment.amountCents);
	}

	const nowMs = now.getTime();
	return pairs.map((pair) => {
		const key = `${normalizeCurrency(pair.currency)}:${pair.debtorId}:${pair.creditorId}`;
		const splits = [...(splitsByPair.get(key) ?? [])].sort((a, b) => a.ts - b.ts);
		let paid = paidByPair.get(key) ?? 0;
		const oldest = splits.find((split) => {
			if (paid >= split.cents) {
				paid -= split.cents;
				return false;
			}
			return true;
		});
		if (!oldest) return 0;
		const diffMs = nowMs - oldest.ts;
		return diffMs <= 0 ? 0 : Math.floor(diffMs / MS_PER_DAY);
	});
}

export function findPairBalance(
	balances: ReadonlyArray<PairBalance>,
	debtorId: string,
	creditorId: string,
	currency?: string,
): PairBalance | null {
	const normalizedCurrency = currency === undefined ? undefined : normalizeCurrency(currency);
	return (
		balances.find(
			(b) =>
				b.debtorId === debtorId &&
				b.creditorId === creditorId &&
				(normalizedCurrency === undefined || b.currency === normalizedCurrency),
		) ?? null
	);
}
