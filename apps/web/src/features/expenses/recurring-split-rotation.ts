import type { RecurringSplit } from './recurring-expenses';

/**
 * A fixed cost split evenly leaves a few cents over. The template stores one fixed result, so
 * the same housemate would pay the extra cent every month. This moves the extra cents on by
 * one person per booking; custom (uneven) splits stay exactly as entered.
 */
export function rotateRemainderCents(
	splits: readonly RecurringSplit[],
	amountCents: number,
	dueAt: Date,
	intervalMonths: number,
): RecurringSplit[] {
	const count = splits.length;
	const base = Math.floor(amountCents / count);
	const extra = amountCents - base * count;
	if (count < 2 || extra === 0) return [...splits];
	const evenWithRemainder =
		splits.every((split) => split.amountCents === base || split.amountCents === base + 1) &&
		splits.filter((split) => split.amountCents === base + 1).length === extra;
	if (!evenWithRemainder) return [...splits];

	const monthIndex = dueAt.getUTCFullYear() * 12 + dueAt.getUTCMonth();
	const cycle = Math.floor(monthIndex / Math.max(1, Math.floor(intervalMonths)));
	const ordered = splits.map((split) => split.debtorMemberId).sort();
	const recipients = new Set(
		Array.from({ length: extra }, (_, index) => ordered[(cycle + index) % count]),
	);
	return splits.map((split) => ({
		debtorMemberId: split.debtorMemberId,
		amountCents: recipients.has(split.debtorMemberId) ? base + 1 : base,
	}));
}
