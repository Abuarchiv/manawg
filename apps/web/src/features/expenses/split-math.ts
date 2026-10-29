/**
 * Splits an integer cent amount across debtors by largest remainder: everyone gets
 * floor(amount / n), the leftover cents (< n) go one each to the first debtors in input
 * order. Sums are exact and shares differ by at most 1 cent; callers rotate debtor order
 * for fairness. amount=1, n=2 yields [1, 0]; the 0 split is kept so the debtor stays part
 * of the expense.
 */

export interface DebtorShare {
	debtorMemberId: string;
	amountCents: number;
}

const MIN_AMOUNT_CENTS = 0;

export function distributeCentsEqually(
	amountCents: number,
	debtorIds: readonly string[],
): number[] {
	if (!Number.isInteger(amountCents) || amountCents < MIN_AMOUNT_CENTS) {
		throw new Error('amountCents must be a non-negative integer');
	}
	if (debtorIds.length === 0) {
		throw new Error('debtorIds must not be empty');
	}
	const n = debtorIds.length;
	const base = Math.floor(amountCents / n);
	const remainder = amountCents - base * n;
	return debtorIds.map((_, idx) => base + (idx < remainder ? 1 : 0));
}

/**
 * Rotate a debtor list by `offset` positions so the "+1 cent" recipient
 * cycles fairly across expenses. Caller passes a stable rotation seed (e.g.
 * `existingExpenseCount % debtors.length`) so two expenses with the same
 * debtor set never give the leftover cent to the same person.
 *
 * Returns a new array; the input is not mutated. Negative offsets are
 * normalized.
 */
function rotateDebtors<T>(debtors: readonly T[], offset: number): T[] {
	const n = debtors.length;
	if (n === 0) return [];
	const k = ((offset % n) + n) % n;
	return [...debtors.slice(k), ...debtors.slice(0, k)];
}

export function buildEqualSplits(
	amountCents: number,
	debtorIds: readonly string[],
	rotationOffset = 0,
): DebtorShare[] {
	const rotated = rotateDebtors(debtorIds, rotationOffset);
	const shares = distributeCentsEqually(amountCents, rotated);
	return rotated.map((id, idx) => ({
		debtorMemberId: id,
		// biome-ignore lint/style/noNonNullAssertion: index is in bounds by construction
		amountCents: shares[idx]!,
	}));
}

/**
 * Server-side validation for a client-provided splits array.
 *
 * Catches everything zod can't express as a single rule:
 *   - duplicate debtor ids (would create double-debt rows)
 *   - splits whose sum doesn't equal the expense total (rounding leak)
 *   - non-finite / negative cents (defense in depth on top of zod)
 *
 * Returns a discriminated result so the caller can map each failure to a
 * specific HTTP error code with a clear message.
 */
type SplitValidationResult =
	| { ok: true; splits: DebtorShare[] }
	| { ok: false; reason: 'empty' | 'duplicate_debtor' | 'sum_mismatch' | 'invalid_amount' };

export function validateSplits(
	amountCents: number,
	splits: readonly DebtorShare[],
): SplitValidationResult {
	if (splits.length === 0) return { ok: false, reason: 'empty' };

	const seen = new Set<string>();
	let sum = 0;
	for (const split of splits) {
		if (
			!Number.isInteger(split.amountCents) ||
			split.amountCents < MIN_AMOUNT_CENTS ||
			!Number.isFinite(split.amountCents)
		) {
			return { ok: false, reason: 'invalid_amount' };
		}
		if (seen.has(split.debtorMemberId)) {
			return { ok: false, reason: 'duplicate_debtor' };
		}
		seen.add(split.debtorMemberId);
		sum += split.amountCents;
	}

	if (sum !== amountCents) return { ok: false, reason: 'sum_mismatch' };
	return { ok: true, splits: splits.map((s) => ({ ...s })) };
}

/**
 * Maps a failed `validateSplits` reason to its HTTP error code, so the
 * client can show a precise message instead of a generic "splits invalid".
 */
export function splitValidationErrorCode(
	reason: Extract<SplitValidationResult, { ok: false }>['reason'],
): 'splits_invalid' | 'splits_duplicate_debtor' | 'splits_sum_mismatch' {
	switch (reason) {
		case 'duplicate_debtor':
			return 'splits_duplicate_debtor';
		case 'sum_mismatch':
			return 'splits_sum_mismatch';
		case 'empty':
		case 'invalid_amount':
			return 'splits_invalid';
	}
}

/**
 * The payer's own share is never a debt (computeBalances skips it), so every insert site
 * (manual, recurring, import) writes it as already settled; otherwise it stays open forever
 * with a settle button that changes no balance.
 */
export function settledAtForOwnShare(debtorMemberId: string, paidByMemberId: string): Date | null {
	return debtorMemberId === paidByMemberId ? new Date() : null;
}

type ShareAmount = { debtorMemberId: string; amountCents: number };

/**
 * Why a PATCH may not replace these splits: a share of a moved-out member must
 * stay as it is, and so must a share someone else already settled, because
 * money moved and changing or dropping it would reopen or erase that payment.
 */
export function splitChangeViolation(
	previous: ReadonlyArray<ShareAmount & { settledAt: Date | null }>,
	next: readonly ShareAmount[],
	activeDebtorIds: ReadonlySet<string>,
	paidByMemberId: string,
): 'member_not_in_wg' | 'expense_has_settled_shares' | null {
	const previousAmounts = new Map(
		previous.map((split) => [split.debtorMemberId, split.amountCents]),
	);
	const nextAmounts = new Map(next.map((split) => [split.debtorMemberId, split.amountCents]));
	const changedInactiveSplit =
		next.some(
			(split) =>
				!activeDebtorIds.has(split.debtorMemberId) &&
				previousAmounts.get(split.debtorMemberId) !== split.amountCents,
		) ||
		previous.some(
			(split) =>
				!activeDebtorIds.has(split.debtorMemberId) &&
				nextAmounts.get(split.debtorMemberId) !== split.amountCents,
		);
	if (changedInactiveSplit) return 'member_not_in_wg';
	const changedSettledShare = previous.some(
		(split) =>
			split.settledAt !== null &&
			split.debtorMemberId !== paidByMemberId &&
			nextAmounts.get(split.debtorMemberId) !== split.amountCents,
	);
	return changedSettledShare ? 'expense_has_settled_shares' : null;
}
