import type { OfflineActionType } from '@/core/offline/offline-queue';
import { formatEuroInput } from '@/core/utils/amount';
import { CENTS_PER_EURO } from '@/core/utils/money';
import { parseTimestamp } from '@/core/utils/time';
import { currencySchema } from '@/core/validators/currency';
import type { buildExpensePrefillDraft } from '@/features/expenses/expense-prefill';
import { rotateRemainderCents } from '@/features/expenses/recurring-split-rotation';
import type { Expense, RecurringExpense } from './expense-types';

export type SplitMode = 'equal' | 'manual';

export type ExpenseSuggestion = Omit<
	NonNullable<ReturnType<typeof buildExpensePrefillDraft>>,
	'splitMode'
> & {
	splitMode: SplitMode;
	recurringSourceId: string | null;
};

/**
 * What a restored draft may contain. Everything is optional because the draft
 * is user-controlled localStorage data from a possibly older app version.
 *
 * A `type` rather than an `interface` on purpose: only type aliases get the
 * implicit index signature that `readDraft`'s `Record<string, unknown>`
 * constraint requires.
 */
export type ExpenseDraft = {
	recurringSourceId?: string | null;
	editingExpense?: unknown;
	description?: string;
	amountStr?: string;
	/** Berlin calendar day (YYYY-MM-DD) of a back-dated expense; empty means "now". */
	occurredOn?: string;
	imageUrl?: string | null;
	paidByMemberId?: string;
	splitMode?: SplitMode;
	manualSplits?: Record<string, string>;
	queueEditId?: string;
	queueEditType?: OfflineActionType;
	recurringIntervalMonths?: number;
	recurringNextDueAt?: string;
};

export type ExpenseEditReference = Pick<Expense, 'id' | 'updatedAt'> & {
	currency?: Expense['currency'];
};

export type DraftEditTarget =
	| { kind: 'none' }
	| { kind: 'valid'; reference: ExpenseEditReference }
	| { kind: 'invalid' };

/**
 * Which expense a restored draft edits. Only an id and a parseable `updatedAt` (the optimistic
 * concurrency check) make a usable reference; anything else is reported as damaged instead of
 * silently turning the edit into a new expense.
 */
export function parseDraftEditTarget(target: unknown): DraftEditTarget {
	if (target === undefined || target === null) return { kind: 'none' };
	if (
		typeof target === 'object' &&
		'id' in target &&
		typeof target.id === 'string' &&
		/^[a-z0-9-]{1,128}$/i.test(target.id) &&
		'updatedAt' in target &&
		typeof target.updatedAt === 'string' &&
		parseTimestamp(target.updatedAt) !== null
	) {
		const currency = 'currency' in target ? currencySchema.safeParse(target.currency) : null;
		return {
			kind: 'valid',
			reference: {
				id: target.id,
				updatedAt: target.updatedAt,
				...(currency?.success ? { currency: currency.data } : {}),
			},
		};
	}
	return { kind: 'invalid' };
}

/** Turns stored cent shares into the euro strings the manual inputs display. */
export function splitsToManualInput(
	splits: ReadonlyArray<{ debtorMemberId: string; amountCents: number }>,
): Record<string, string> {
	return Object.fromEntries(
		splits.map((split) => [
			split.debtorMemberId,
			formatEuroInput(split.amountCents / CENTS_PER_EURO),
		]),
	);
}

/**
 * A one-off expense prefilled from a due fixed-cost template. Its extra cents are placed as the
 * monthly booking would place them, so booking by hand charges the same member as the cron.
 */
export function recurringTemplateSuggestion(template: RecurringExpense): ExpenseSuggestion {
	const splits = rotateRemainderCents(
		template.splits,
		template.amountCents,
		new Date(template.nextDueAt),
		template.intervalMonths,
	);
	return {
		description: template.description,
		amountStr: formatEuroInput(template.amountCents / CENTS_PER_EURO),
		imageUrl: null,
		paidByMemberId: template.paidByMemberId,
		splitMode: 'manual',
		manualSplits: splitsToManualInput(splits),
		recurringSourceId: template.id,
	};
}
