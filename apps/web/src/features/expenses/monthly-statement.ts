import { berlinDayKey } from '@/core/utils/berlin-day';
import { normalizeCurrency } from '@/core/utils/money';
import { type SimplifiedDebt, simplifyDebts } from './debt-reduction';

export interface StatementExpense {
	id: string;
	paidByMemberId: string;
	amountCents: number;
	currency: string;
	description: string;
	occurredAt: string;
	splits: Array<{ debtorMemberId: string; amountCents: number; settledAt: string | null }>;
}

export interface StatementMemberInput {
	id: string;
	name: string;
	active: boolean;
}

interface StatementMemberRow {
	id: string;
	name: string;
	paidCents: number;
	shareCents: number;
	balanceCents: number;
}

interface StatementItem {
	id: string;
	occurredAt: string;
	description: string;
	payerName: string;
	amountCents: number;
}

export interface MonthlyStatement {
	monthKey: string;
	totalCents: number;
	items: StatementItem[];
	members: StatementMemberRow[];
	transfers: SimplifiedDebt[];
	/** Every share owed to someone else in this month is settled. */
	settled: boolean;
}

/** Berlin calendar month (YYYY-MM) of an instant. */
export function berlinMonthKey(date: Date): string {
	return berlinDayKey(date).slice(0, 7);
}

/** YYYY-MM shifted by whole months. */
export function shiftMonthKey(monthKey: string, delta: number): string {
	const [year, month] = monthKey.split('-').map(Number);
	const index = (year ?? 0) * 12 + (month ?? 1) - 1 + delta;
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * One month of a WG's expenses: what each member paid, their share, the
 * month balance (paid minus share) and the fewest transfers that clear it.
 * Balances count settled shares too, so a paid-off month still shows who
 * carried what. Only EUR expenses are counted.
 */
export function buildMonthlyStatement(
	expenses: readonly StatementExpense[],
	members: readonly StatementMemberInput[],
	monthKey: string,
): MonthlyStatement {
	const inMonth = expenses
		.filter(
			(expense) =>
				normalizeCurrency(expense.currency) === 'EUR' &&
				berlinMonthKey(new Date(expense.occurredAt)) === monthKey,
		)
		.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

	const paid = new Map<string, number>();
	const share = new Map<string, number>();
	let settled = true;
	for (const expense of inMonth) {
		paid.set(expense.paidByMemberId, (paid.get(expense.paidByMemberId) ?? 0) + expense.amountCents);
		for (const split of expense.splits) {
			share.set(split.debtorMemberId, (share.get(split.debtorMemberId) ?? 0) + split.amountCents);
			if (split.debtorMemberId !== expense.paidByMemberId && split.settledAt === null) {
				settled = false;
			}
		}
	}

	const nameOf = (id: string) =>
		members.find((member) => member.id === id)?.name ?? 'Ehemaliges Mitglied';
	// Active members always appear; former members only when they took part this month.
	const rows = members
		.filter((member) => member.active || paid.has(member.id) || share.has(member.id))
		.map((member) => {
			const paidCents = paid.get(member.id) ?? 0;
			const shareCents = share.get(member.id) ?? 0;
			return {
				id: member.id,
				name: member.name,
				paidCents,
				shareCents,
				balanceCents: paidCents - shareCents,
			};
		});

	const transfers = simplifyDebts(
		rows.map((row) => ({
			memberId: row.id,
			memberName: row.name,
			color: null,
			cents: row.balanceCents,
			currency: 'EUR',
		})),
	);

	return {
		monthKey,
		totalCents: inMonth.reduce((sum, expense) => sum + expense.amountCents, 0),
		items: inMonth.map((expense) => ({
			id: expense.id,
			occurredAt: expense.occurredAt,
			description: expense.description,
			payerName: nameOf(expense.paidByMemberId),
			amountCents: expense.amountCents,
		})),
		members: rows,
		transfers,
		settled,
	};
}
