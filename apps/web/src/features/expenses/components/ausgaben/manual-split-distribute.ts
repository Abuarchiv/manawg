import { eurosToCents, formatCentsInput, parseEuroAmount } from '@/core/utils/amount';

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
	let remainingCents = remainderCents;
	let remainingTargets = targets;
	// Repeats the member pass after a cap; sorting balances would help only if household sizes make rescans costly.
	while (remainingCents !== 0 && remainingTargets.length > 0) {
		const perCent = Math.floor(remainingCents / remainingTargets.length);
		let leftover = remainingCents - perCent * remainingTargets.length;
		let unappliedCents = 0;
		const nextTargets: { id: string }[] = [];
		for (const t of remainingTargets) {
			const curEuros = parseEuroAmount(next[t.id] ?? '') ?? 0;
			const curCents = eurosToCents(curEuros);
			const addCents = perCent + (leftover > 0 ? 1 : leftover < 0 ? -1 : 0);
			if (leftover > 0) leftover--;
			else if (leftover < 0) leftover++;
			// Clamp at zero, then redistribute any reduction that did not fit.
			const nextCents = Math.max(0, curCents + addCents);
			unappliedCents += curCents + addCents - nextCents;
			if (nextCents > 0) nextTargets.push(t);
			next[t.id] = formatCentsInput(nextCents);
		}
		remainingCents = unappliedCents;
		remainingTargets = nextTargets;
	}
	return next;
}
