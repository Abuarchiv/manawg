import type { OfflineActionType } from '@/core/offline/offline-queue';
import { eurosToCents, formatCentsInput, parseEuroAmount } from '@/core/utils/amount';
import { parseTimestamp } from '@/core/utils/time';
import { isSupportedCurrency } from '@/core/validators/currencies';
import type { ExpenseCategory } from '@/features/expenses/expense-categories';
import type { buildExpensePrefillDraft } from '@/features/expenses/expense-prefill';
import {
	equalSplitParticipants,
	type SplitMemberLike,
	type SplitMode,
} from '@/features/expenses/expense-split-input';
import type {
	Expense,
	ExpenseSplitShare,
	RecurringExpense,
} from '@/features/expenses/expense-types';
import { rotateRemainderCents } from '@/features/expenses/recurring-split-rotation';
import type { Locale } from '@/shared/i18n/locale';

export type { SplitMode };

export type ExpenseSuggestion = Omit<
	NonNullable<ReturnType<typeof buildExpensePrefillDraft>>,
	'splitMode'
> & {
	splitMode: SplitMode;
	recurringSourceId: string | null;
	category?: ExpenseCategory;
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
	category?: string;
	amountStr?: string;
	imageUrl?: string | null;
	paidByMemberId?: string;
	splitMode?: SplitMode;
	manualSplits?: Record<string, string>;
	occurredOn?: string | null;
	participantIds?: string[] | null;
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
		const currency = 'currency' in target ? target.currency : null;
		return {
			kind: 'valid',
			reference: {
				id: target.id,
				updatedAt: target.updatedAt,
				...(isSupportedCurrency(currency) ? { currency } : {}),
			},
		};
	}
	return { kind: 'invalid' };
}

/** Turns stored cent shares into the euro strings the manual inputs display. */
export function splitsToManualInput(
	splits: ReadonlyArray<ExpenseSplitShare>,
	locale: Locale = 'de',
): Record<string, string> {
	return Object.fromEntries(
		splits.map((split) => [split.debtorMemberId, formatCentsInput(split.amountCents, locale)]),
	);
}

/** A one-off expense prefilled from a due fixed-cost template. */
export function recurringTemplateSuggestion(
	template: RecurringExpense,
	locale: Locale = 'de',
): ExpenseSuggestion {
	// A manual booking charges the extra cent to the same person as the automatic one.
	const splits = rotateRemainderCents(
		template.splits,
		template.amountCents,
		new Date(template.nextDueAt),
		template.intervalMonths,
	);
	return {
		description: template.description,
		category: template.category,
		amountStr: formatCentsInput(template.amountCents, locale),
		imageUrl: null,
		paidByMemberId: template.paidByMemberId,
		splitMode: 'manual',
		manualSplits: splitsToManualInput(splits, locale),
		recurringSourceId: template.id,
	};
}

/** The participants of a queued expense when its saved shares are an equal split, else null. */
export function queuedEqualParticipants(
	draft: ExpenseDraft,
	members: readonly SplitMemberLike[],
	locale: Locale = 'de',
): string[] | null {
	const amount = parseEuroAmount(draft.amountStr ?? '', locale);
	if (amount === null || !draft.manualSplits) return null;
	const splits = Object.entries(draft.manualSplits).flatMap(([debtorMemberId, value]) => {
		const share = parseEuroAmount(value, locale);
		return share === null ? [] : [{ debtorMemberId, amountCents: eurosToCents(share) }];
	});
	return equalSplitParticipants(eurosToCents(amount), splits, members);
}

/** `null` stands for "every active member". */
export function participantsOrAll(
	participants: string[],
	members: readonly SplitMemberLike[],
): string[] | null {
	return participants.length === members.filter((member) => member.active).length
		? null
		: participants;
}
