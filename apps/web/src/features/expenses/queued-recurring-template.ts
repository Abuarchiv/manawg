import type { OfflineAction } from '@/core/offline/offline-queue';
import type { DebtorShare } from '@/features/expenses/split-math';

const byDebtor = (left: DebtorShare, right: DebtorShare) =>
	left.debtorMemberId.localeCompare(right.debtorMemberId);

function isQueuedSplit(split: unknown): split is DebtorShare {
	return (
		typeof split === 'object' &&
		split !== null &&
		'debtorMemberId' in split &&
		typeof split.debtorMemberId === 'string' &&
		'amountCents' in split &&
		typeof split.amountCents === 'number'
	);
}

/**
 * Equal splits rotate the leftover cent between members, so a queued equal
 * split counts as the same when it covers the same debtors, sums to the
 * amount and differs by at most one cent per share.
 */
function queuedSplitsMatch(
	queuedSplits: DebtorShare[],
	currentSplits: DebtorShare[],
	splitMode: 'equal' | 'manual',
	amountCents: number,
): boolean {
	const queued = [...queuedSplits].sort(byDebtor);
	const current = [...currentSplits].sort(byDebtor);
	if (splitMode === 'manual') return JSON.stringify(queued) === JSON.stringify(current);
	const amounts = queued.map((split) => split.amountCents);
	return (
		JSON.stringify(queued.map((split) => split.debtorMemberId)) ===
			JSON.stringify(current.map((split) => split.debtorMemberId)) &&
		amounts.reduce((sum, cents) => sum + cents, 0) === amountCents &&
		(queued.length < 2 || Math.max(...amounts) - Math.min(...amounts) <= 1)
	);
}

/**
 * A `recurring.create` action already waiting in the offline queue for the
 * same template, so saving it again does not queue a duplicate.
 */
export function findQueuedRecurringTemplate({
	queue,
	wgId,
	shareCode,
	memberId,
	description,
	amountCents,
	paidByMemberId,
	intervalMonths,
	splits,
	splitMode,
	queuedNextDueAt,
}: {
	queue: readonly OfflineAction[];
	wgId: string;
	shareCode: string;
	memberId: string;
	description: string;
	amountCents: number;
	paidByMemberId: string;
	intervalMonths: number;
	splits: DebtorShare[];
	splitMode: 'equal' | 'manual';
	/** Epoch ms of the due date an edited queued template was queued with. */
	queuedNextDueAt: number | null;
}): OfflineAction | undefined {
	return queue.find((action) => {
		if (
			action.type !== 'recurring.create' ||
			action.wgId !== wgId ||
			action.shareCode !== shareCode ||
			action.memberId !== memberId
		) {
			return false;
		}
		const payload = action.payload;
		const rawSplits: unknown = payload.splits;
		if (
			typeof payload.description !== 'string' ||
			typeof payload.amountCents !== 'number' ||
			typeof payload.paidByMemberId !== 'string' ||
			typeof payload.intervalMonths !== 'number' ||
			typeof payload.nextDueAt !== 'string' ||
			!Array.isArray(rawSplits) ||
			!rawSplits.every(isQueuedSplit)
		) {
			return false;
		}
		return (
			payload.description === description &&
			payload.amountCents === amountCents &&
			payload.paidByMemberId === paidByMemberId &&
			payload.intervalMonths === intervalMonths &&
			queuedSplitsMatch(rawSplits, splits, splitMode, amountCents) &&
			(queuedNextDueAt === null || payload.nextDueAt === new Date(queuedNextDueAt).toISOString())
		);
	});
}
