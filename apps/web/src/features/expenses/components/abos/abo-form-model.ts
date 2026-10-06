import { formatEuroInput, parseEuroAmount } from '@/core/utils/amount';
import { todayInputValue } from '@/core/utils/local-date';
import { CENTS_PER_EURO } from '@/core/utils/money';
import type { AboSplit, MemberOption } from '@/features/expenses/components/abos/abos-types';

export const DESCRIPTION_MAX = 200;
export const AMOUNT_MIN_EUROS = 0.01;
export const AMOUNT_MAX_EUROS = 1_000_000;

export const INTERVAL_OPTIONS = [
	{ value: 1, label: '1 Monat' },
	{ value: 3, label: '3 Monate (Quartal)' },
	{ value: 6, label: '6 Monate' },
	{ value: 12, label: '12 Monate (Jahr)' },
] as const;

export interface AboFormValues {
	description: string;
	amountCents: number;
	paidByMemberId: string;
	intervalMonths: number;
	nextDueAt: string;
	splits: AboSplit[];
}

export type SplitMode = 'equal' | 'manual';
export type AboSplitBuildError =
	| 'amount_invalid'
	| 'invalid_share'
	| 'no_members'
	| 'splits_empty'
	| 'splits_mismatch';

export function buildEqualSplits(members: MemberOption[], amountCents: number): AboSplit[] {
	// Only active members carry a share of a new equal split; members who
	// moved out stay in history but must not divide the amount.
	const participants = members.some((member) => member.active)
		? members.filter((member) => member.active)
		: members;
	if (participants.length === 0) return [];
	const base = Math.floor(amountCents / participants.length);
	const remainder = amountCents - base * participants.length;
	return participants.map((member, index) => ({
		debtorMemberId: member.id,
		amountCents: base + (index < remainder ? 1 : 0),
	}));
}

export function isoDateToInput(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return todayInputValue();
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function initialSplitMode(
	initial: AboFormValues | undefined,
	members: MemberOption[],
): SplitMode {
	if (!initial) return 'equal';
	const equal = buildEqualSplits(members, initial.amountCents);
	const sameLength = initial.splits.length === equal.length;
	if (!sameLength) return 'manual';
	const sortedInitial = [...initial.splits].sort((a, b) =>
		a.debtorMemberId.localeCompare(b.debtorMemberId),
	);
	const sortedEqual = [...equal].sort((a, b) => a.debtorMemberId.localeCompare(b.debtorMemberId));
	const allEqual = sortedInitial.every((split, idx) => {
		const counterpart = sortedEqual[idx];
		return (
			counterpart !== undefined &&
			split.debtorMemberId === counterpart.debtorMemberId &&
			split.amountCents === counterpart.amountCents
		);
	});
	return allEqual ? 'equal' : 'manual';
}

export function initialManualMap(initial: AboFormValues | undefined): Record<string, string> {
	if (!initial) return {};
	return Object.fromEntries(
		initial.splits.map((split) => [
			split.debtorMemberId,
			formatEuroInput(split.amountCents / CENTS_PER_EURO),
		]),
	);
}

/** Splits for the form state: equal over active members, or the manual shares summing to the amount. */
export function buildAboSplits(input: {
	amountCents: number | null;
	splitMode: SplitMode;
	activeMembers: MemberOption[];
	splitCandidates: MemberOption[];
	manualSplits: Record<string, string>;
}): AboSplit[] | AboSplitBuildError {
	const {
		amountCents: parsedAmountCents,
		splitMode,
		activeMembers,
		splitCandidates,
		manualSplits,
	} = input;
	if (parsedAmountCents === null) return 'amount_invalid';
	if (splitMode === 'equal') {
		const equal = buildEqualSplits(activeMembers, parsedAmountCents);
		if (equal.length === 0) return 'no_members';
		return equal;
	}
	const splits: AboSplit[] = [];
	let sum = 0;
	for (const member of splitCandidates) {
		const raw = manualSplits[member.id] ?? '';
		if (raw.trim().length === 0) continue;
		const value = parseEuroAmount(raw);
		if (value === null || value < 0) return 'invalid_share';
		if (value === 0) continue;
		const cents = Math.round(value * CENTS_PER_EURO);
		splits.push({ debtorMemberId: member.id, amountCents: cents });
		sum += cents;
	}
	if (splits.length === 0) return 'splits_empty';
	if (sum !== parsedAmountCents) return 'splits_mismatch';
	return splits;
}
