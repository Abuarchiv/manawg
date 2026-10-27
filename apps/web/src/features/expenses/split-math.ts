/**
 * Fair expense splitting math.
 *
 * Centralized here so the UI, server validation and any future server-side
 * "auto-split" call site share one provably-correct, deterministic
 * implementation. Currency amounts are always integer cents — we never round
 * a float at the boundary, because a sum of rounded floats is not guaranteed
 * to equal the original total (classic 333,333… cent problem).
 *
 * Rounding strategy: Hamilton / largest-remainder.
 *   1. Every debtor gets floor(amount / n) cents.
 *   2. The leftover cents (always < n) are distributed one cent at a time
 *      to the FIRST k debtors in the input order.
 *
 * Properties this guarantees:
 *   - sum(splits) === amount, exactly.
 *   - max(splits) - min(splits) <= 1 cent — nobody pays more than one cent
 *     extra over anybody else.
 *   - Deterministic for a given debtor order: callers control fairness by
 *     rotating who is at index 0 (e.g. round-robin across expenses).
 *   - Works for any amount >= 0 and any n >= 1.
 *
 * Edge cases worth knowing:
 *   - amount=1, n=2 → [1, 0]. The single cent goes to the first debtor; the
 *     second debtor owes zero. We keep the 0-cent split because dropping it
 *     would silently change who's "in" the expense.
 *   - amount=0 → all splits are 0.
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
 * The payer's own share of an expense is never a debt: `computeBalances`
 * (debts.ts) already skips any split where the debtor is also the creditor.
 * Every insert site (manual create, recurring advance, import commit) should
 * write that split as already settled, otherwise it sits at `settledAt: null`
 * forever unless someone manually toggles it — showing the payer's own share
 * as a permanently "Offen" line with a settle button that has zero effect on
 * any balance, and undercounting the "X/Y beglichen" progress next to every
 * expense.
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
