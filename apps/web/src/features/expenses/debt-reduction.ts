import type { ExpensePaymentInput } from './expense-payments';

export interface SimplifiedDebt {
	fromId: string;
	fromName: string;
	toId: string;
	toName: string;
	cents: number;
}

export interface SettlementSummary {
	directCount: number;
	simplifiedCount: number;
	savedTransfers: number;
	totalOpenCents: number;
	simplified: SimplifiedDebt[];
}

interface BalanceEntry {
	memberId: string;
	memberName: string;
	color: string | null;
	cents: number;
}

interface ExpenseInput {
	paidByMemberId: string;
	splits: Array<{
		debtorMemberId: string;
		amountCents: number;
		settledAt: string | null;
	}>;
}

interface MemberInput {
	id: string;
	name: string;
	color: string | null;
}

export function computeDirectDebts(
	expenses: ExpenseInput[],
	members: MemberInput[],
	payments: readonly ExpensePaymentInput[] = [],
): SimplifiedDebt[] {
	const memberNames = new Map(members.map((m) => [m.id, m.name]));
	const totals = new Map<string, SimplifiedDebt>();

	for (const expense of expenses) {
		const toId = expense.paidByMemberId;
		const toName = memberNames.get(toId);
		if (!toName) continue;

		for (const split of expense.splits) {
			if (split.settledAt !== null) continue;
			if (split.amountCents <= 0) continue;
			if (split.debtorMemberId === toId) continue;

			const fromName = memberNames.get(split.debtorMemberId);
			if (!fromName) continue;

			const key = `${split.debtorMemberId}:${toId}`;
			const current = totals.get(key);
			if (current) {
				current.cents += split.amountCents;
			} else {
				totals.set(key, {
					fromId: split.debtorMemberId,
					fromName,
					toId,
					toName,
					cents: split.amountCents,
				});
			}
		}
	}
	for (const payment of payments) {
		if (payment.amountCents <= 0 || payment.fromMemberId === payment.toMemberId) continue;
		const fromName = memberNames.get(payment.fromMemberId);
		const toName = memberNames.get(payment.toMemberId);
		if (!fromName || !toName) continue;
		const key = `${payment.fromMemberId}:${payment.toMemberId}`;
		const current = totals.get(key);
		if (current) {
			current.cents -= payment.amountCents;
		} else {
			totals.set(key, {
				fromId: payment.fromMemberId,
				fromName,
				toId: payment.toMemberId,
				toName,
				cents: -payment.amountCents,
			});
		}
	}

	return Array.from(totals.values())
		.filter((debt) => debt.cents > 0)
		.sort((a, b) => b.cents - a.cents || a.fromName.localeCompare(b.fromName));
}

export function computeNetBalances(
	expenses: ExpenseInput[],
	members: MemberInput[],
	payments: readonly ExpensePaymentInput[] = [],
): BalanceEntry[] {
	const known = new Set(members.map((m) => m.id));
	const cents = new Map<string, number>(members.map((m) => [m.id, 0]));

	for (const e of expenses) {
		// Skip expenses paid by a departed member — their balance is dropped from
		// the returned roster, so counting it would unbalance the net sum.
		if (!known.has(e.paidByMemberId)) continue;
		for (const s of e.splits) {
			if (s.settledAt !== null) continue;
			if (s.amountCents <= 0) continue;
			// Skip the payer's own share — it's already accounted for in paidCents
			if (s.debtorMemberId === e.paidByMemberId) continue;
			// Skip splits owed by a departed member (mirror computeDirectDebts).
			if (!known.has(s.debtorMemberId)) continue;
			cents.set(e.paidByMemberId, (cents.get(e.paidByMemberId) ?? 0) + s.amountCents);
			cents.set(s.debtorMemberId, (cents.get(s.debtorMemberId) ?? 0) - s.amountCents);
		}
	}
	for (const payment of payments) {
		if (payment.amountCents <= 0 || payment.fromMemberId === payment.toMemberId) continue;
		if (!known.has(payment.fromMemberId) || !known.has(payment.toMemberId)) continue;
		cents.set(payment.fromMemberId, (cents.get(payment.fromMemberId) ?? 0) + payment.amountCents);
		cents.set(payment.toMemberId, (cents.get(payment.toMemberId) ?? 0) - payment.amountCents);
	}

	return members.map((m) => ({
		memberId: m.id,
		memberName: m.name,
		color: m.color,
		cents: cents.get(m.id) ?? 0,
	}));
}

export function simplifyDebts(balances: BalanceEntry[]): SimplifiedDebt[] {
	const creditors = balances
		.filter((b) => b.cents > 0)
		.map((b) => ({ ...b }))
		.sort((a, b) => b.cents - a.cents);
	const debtors = balances
		.filter((b) => b.cents < 0)
		.map((b) => ({ ...b }))
		.sort((a, b) => a.cents - b.cents);

	const result: SimplifiedDebt[] = [];
	let i = 0;
	let j = 0;
	while (i < debtors.length && j < creditors.length) {
		const debtor = debtors[i];
		const creditor = creditors[j];
		if (!debtor || !creditor) break;
		const amount = Math.min(-debtor.cents, creditor.cents);
		if (amount > 0) {
			result.push({
				fromId: debtor.memberId,
				fromName: debtor.memberName,
				toId: creditor.memberId,
				toName: creditor.memberName,
				cents: amount,
			});
		}
		debtor.cents += amount;
		creditor.cents -= amount;
		if (debtor.cents === 0) i++;
		if (creditor.cents === 0) j++;
	}
	return result;
}

export function buildSettlementSummary(
	expenses: ExpenseInput[],
	members: MemberInput[],
	payments: readonly ExpensePaymentInput[] = [],
): SettlementSummary {
	const direct = computeDirectDebts(expenses, members, payments);
	const simplified = simplifyDebts(computeNetBalances(expenses, members, payments));
	return {
		directCount: direct.length,
		simplifiedCount: simplified.length,
		savedTransfers: Math.max(0, direct.length - simplified.length),
		totalOpenCents: direct.reduce((sum, debt) => sum + debt.cents, 0),
		simplified,
	};
}
