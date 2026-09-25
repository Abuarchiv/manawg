import { formatEuroInput, parseEuroAmount } from '@/core/utils/amount';
import { CENTS_PER_EURO } from '@/core/utils/money';

/**
 * Pure remainder-distribution step behind "Rest aufteilen", kept out of the
 * component file (which has JSX) so it can be unit-tested with node's plain
 * `.ts` loader. Too little entered: tops up the empty fields. Too much:
 * claws the excess back from the fields that actually carry an amount —
 * targeting empty ones there would drive them negative, and the input can't
 * express that (parseEuroAmount rejects a leading "-"), so the value would
 * silently drop out of the sum instead of fixing it. Every field is clamped
 * at zero.
 */
export function distributeRemainderCents(
	manualSplits: Readonly<Record<string, string>>,
	members: ReadonlyArray<{ id: string }>,
	remainderCents: number,
): Record<string, string> {
	if (remainderCents === 0) return { ...manualSplits };
	const isEmpty = (m: { id: string }) => {
		const v = manualSplits[m.id];
		if (!v) return true;
		const n = parseEuroAmount(v);
		return n === null || n === 0;
	};
	const emptyMembers = members.filter(isEmpty);
	const filledMembers = members.filter((m) => !isEmpty(m));
	const targets =
		remainderCents > 0
			? emptyMembers.length > 0
				? emptyMembers
				: members
			: filledMembers.length > 0
				? filledMembers
				: members;
	const next = { ...manualSplits };
	if (targets.length === 0) return next;
	const perCent = Math.floor(remainderCents / targets.length);
	let leftover = remainderCents - perCent * targets.length;
	for (const t of targets) {
		const curEuros = parseEuroAmount(next[t.id] ?? '') ?? 0;
		const curCents = Math.round(curEuros * CENTS_PER_EURO);
		const addCents = perCent + (leftover > 0 ? 1 : leftover < 0 ? -1 : 0);
		if (leftover > 0) leftover--;
		else if (leftover < 0) leftover++;
		// Clamp at zero: a field can only ever hold a non-negative amount.
		const nextCents = Math.max(0, curCents + addCents);
		next[t.id] = formatEuroInput(nextCents / CENTS_PER_EURO);
	}
	return next;
}
