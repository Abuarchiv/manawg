interface GuardedSplit {
	debtorMemberId: string;
	amountCents: number;
}

type PaidByGuardResult = { ok: true } | { ok: false; reason: 'paid_by_must_include_caller' };

/**
 * Abuse guard: when the caller logs an expense paid by SOMEONE ELSE, require
 * the caller to bear a positive share in the split. This prevents pure
 * fabrication ("Alice silently makes Charlie owe Bob 30€") while still
 * allowing the legitimate "log on behalf of" UX where the caller is part of
 * the cost group. Self-paid expenses (paidBy === caller) are unrestricted.
 * Combined with the audit trail and any-debtor delete permission, this keeps
 * creation honest.
 *
 * Kept free of database imports so the manual, recurring and import paths
 * can all share it.
 */
export function checkPaidByGuard(
	paidByMemberId: string,
	callerId: string,
	splits: readonly GuardedSplit[],
): PaidByGuardResult {
	if (
		paidByMemberId !== callerId &&
		!splits.some((split) => split.debtorMemberId === callerId && split.amountCents > 0)
	) {
		return { ok: false, reason: 'paid_by_must_include_caller' };
	}
	return { ok: true };
}
