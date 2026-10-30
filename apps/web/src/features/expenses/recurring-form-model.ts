import { eurosToCents, formatCentsInput, parseEuroAmount } from '@/core/utils/amount';
import type { ExpenseCategory } from '@/features/expenses/expense-categories';
import { AMOUNT_MAX_EUROS } from '@/features/expenses/expense-constants';
import { participantsOrAll } from '@/features/expenses/expense-form-draft';
import { equalSplitParticipants, type SplitMode } from '@/features/expenses/expense-split-input';
import type { MemberOption, RecurringSplit } from '@/features/expenses/expense-types';
import { distributeCentsEqually } from '@/features/expenses/split-math';
import type { Locale } from '@/shared/i18n/locale';
import type { Message } from '@/shared/i18n/message';

export type { SplitMode };

export interface RecurringFormValues {
	description: string;
	category: ExpenseCategory;
	amountCents: number;
	paidByMemberId: string;
	intervalMonths: number;
	nextDueAt: string;
	splits: RecurringSplit[];
}

export type RecurringSplitBuildError =
	| 'amount_invalid'
	| 'invalid_share'
	| 'no_members'
	| 'splits_empty'
	| 'splits_mismatch';

export function buildEqualSplits(
	members: MemberOption[],
	amountCents: number,
	participantIds?: readonly string[] | null,
): RecurringSplit[] {
	// Only active members carry a share of a new equal split; members who
	// moved out stay in history but must not divide the amount.
	const active = members.some((member) => member.active)
		? members.filter((member) => member.active)
		: members;
	const participants = participantIds
		? active.filter((member) => participantIds.includes(member.id))
		: active;
	if (participants.length === 0) return [];
	const shares = distributeCentsEqually(
		amountCents,
		participants.map((member) => member.id),
	);
	return participants.map((member, index) => ({
		debtorMemberId: member.id,
		amountCents: shares[index] ?? 0,
	}));
}

/** The members of a saved equal split (null = everyone), or 'manual' when the shares differ. */
export function initialEqualParticipants(
	initial: RecurringFormValues | undefined,
	members: MemberOption[],
): string[] | null | 'manual' {
	if (!initial) return null;
	const participants = equalSplitParticipants(initial.amountCents, initial.splits, members);
	return participants ? participantsOrAll(participants, members) : 'manual';
}

export function initialManualMap(
	initial: RecurringFormValues | undefined,
	locale: Locale = 'de',
): Record<string, string> {
	if (!initial) return {};
	return Object.fromEntries(
		initial.splits.map((split) => [
			split.debtorMemberId,
			formatCentsInput(split.amountCents, locale),
		]),
	);
}

/** Why an amount field is rejected; above the maximum the amount is too large, not too small. */
export function recurringAmountError(euros: number | null, raw: string): Message {
	if (euros === null && /[.,]\d{3,}\s*(€|EUR)?$/i.test(raw.trim())) {
		return { key: 'expenses-recurring.form.error.amountDecimals' };
	}
	return euros !== null && euros > AMOUNT_MAX_EUROS
		? { key: 'expenses-recurring.form.error.amountMax' }
		: { key: 'expenses-recurring.form.error.amountPositive' };
}

const SPLIT_ERROR_KEYS = {
	invalid_share: 'expenses-recurring.form.error.invalidShare',
	splits_empty: 'expenses-recurring.form.error.splitsEmpty',
	splits_mismatch: 'expenses-recurring.errors.splitsMismatch',
} as const;

/** The error shown under the split fields for a failed manual split. */
export function recurringSplitError(reason: keyof typeof SPLIT_ERROR_KEYS): Message {
	return { key: SPLIT_ERROR_KEYS[reason] };
}

/** Splits for the form state: equal over active members, or the manual shares summing to the amount. */
export function buildRecurringSplits(input: {
	amountCents: number | null;
	splitMode: SplitMode;
	activeMembers: MemberOption[];
	splitCandidates: MemberOption[];
	manualSplits: Record<string, string>;
	participantIds?: readonly string[] | null;
	locale?: Locale;
}): RecurringSplit[] | RecurringSplitBuildError {
	const {
		amountCents: parsedAmountCents,
		splitMode,
		activeMembers,
		splitCandidates,
		manualSplits,
		participantIds,
		locale = 'de',
	} = input;
	if (parsedAmountCents === null) return 'amount_invalid';
	if (splitMode === 'equal') {
		const equal = buildEqualSplits(activeMembers, parsedAmountCents, participantIds);
		if (equal.length === 0) return 'no_members';
		return equal;
	}
	const splits: RecurringSplit[] = [];
	let sum = 0;
	for (const member of splitCandidates) {
		const raw = manualSplits[member.id] ?? '';
		if (raw.trim().length === 0) continue;
		const value = parseEuroAmount(raw, locale);
		if (value === null || value < 0) return 'invalid_share';
		if (value === 0) continue;
		const cents = eurosToCents(value);
		splits.push({ debtorMemberId: member.id, amountCents: cents });
		sum += cents;
	}
	if (splits.length === 0) return 'splits_empty';
	if (sum !== parsedAmountCents) return 'splits_mismatch';
	return splits;
}
