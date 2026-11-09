import { formatEuroCents } from '@/core/utils/money';
import type { Locale } from '@/shared/i18n/locale';
import type { Message } from '@/shared/i18n/message';

/**
 * What an expense means for me (like Splitwise: "you get" / "you owe"),
 * instead of showing only the total.
 */
export type ExpenseImpact =
	| { kind: 'lent'; cents: number }
	| { kind: 'owe'; cents: number }
	| { kind: 'settled'; cents: number }
	| { kind: 'own'; cents: number }
	| { kind: 'none'; cents: number };

interface ImpactExpense {
	paidByMemberId: string;
	amountCents: number;
	splits: ReadonlyArray<{ debtorMemberId: string; amountCents: number; settledAt: string | null }>;
}

export function getExpenseImpact(expense: ImpactExpense, memberId: string): ExpenseImpact {
	if (expense.paidByMemberId === memberId) {
		const others = expense.splits.filter(
			(split) => split.debtorMemberId !== memberId && split.amountCents > 0,
		);
		if (others.length === 0) return { kind: 'own', cents: expense.amountCents };
		const open = others
			.filter((split) => split.settledAt === null)
			.reduce((sum, split) => sum + split.amountCents, 0);
		if (open > 0) return { kind: 'lent', cents: open };
		return {
			kind: 'settled',
			cents: others.reduce((sum, split) => sum + split.amountCents, 0),
		};
	}
	const mine = expense.splits.find(
		(split) => split.debtorMemberId === memberId && split.amountCents > 0,
	);
	if (!mine) return { kind: 'none', cents: expense.amountCents };
	return mine.settledAt === null
		? { kind: 'owe', cents: mine.amountCents }
		: { kind: 'settled', cents: mine.amountCents };
}

interface SavedToastExpense extends ImpactExpense {
	currency: string;
}

/**
 * The toast text after saving: what the expense means for the saver instead of a bare "saved".
 * `nameOf` resolves a member id to a display name.
 */
export function savedExpenseMessage(
	expense: SavedToastExpense,
	memberId: string,
	nameOf: (id: string) => string,
	locale: Locale,
	isEdit: boolean,
): Message {
	const impact = getExpenseImpact(expense, memberId);
	const money = formatEuroCents(impact.cents, expense.currency, { locale });
	if (impact.kind === 'lent') {
		const open = expense.splits.filter(
			(split) =>
				split.debtorMemberId !== memberId && split.amountCents > 0 && split.settledAt === null,
		);
		return {
			key: 'expenses-form.notices.savedLent',
			values: {
				amount: money,
				count: open.length,
				name: open[0] ? nameOf(open[0].debtorMemberId) : '',
			},
		};
	}
	if (impact.kind === 'owe') {
		return {
			key: 'expenses-form.notices.savedOwe',
			values: { amount: money, payer: nameOf(expense.paidByMemberId) },
		};
	}
	if (impact.kind === 'own') return { key: 'expenses-form.notices.savedOwn' };
	return { key: isEdit ? 'expenses-form.notices.updated' : 'expenses-form.notices.saved' };
}
