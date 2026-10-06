import type { OfflineAction } from '@/core/offline/offline-queue';
import { addMonths } from '@/core/utils/time';

/** Scheduling and queue checks for fixed-cost templates, kept pure for tests. */

interface TemplateSchedulePlan {
	/** Unclamped start day sent as anchor for a new template; null when editing or replaying. */
	startsAt: string | null;
	nextDueAt: Date;
}

interface TemplateScheduleInput {
	/** The template being edited keeps its due date. */
	editingNextDueAt: string | null;
	/** A queued template being edited keeps the due date it was queued with. */
	queuedNextDueAt: number | null;
	/** A retry of an unconfirmed create reuses its anchor and due date. */
	pending: { anchorAt?: string; nextDueAt: string } | null;
	intervalMonths: number;
	today: () => Date;
}

/**
 * A new template starts today and is first due one interval later. The unclamped start day is
 * sent as the anchor, so a template begun on the 31st keeps billing on month ends instead of
 * sticking to the 28th.
 */
export function planTemplateSchedule({
	editingNextDueAt,
	queuedNextDueAt,
	pending,
	intervalMonths,
	today,
}: TemplateScheduleInput): TemplateSchedulePlan {
	const startsAt =
		editingNextDueAt !== null || queuedNextDueAt !== null
			? null
			: pending
				? (pending.anchorAt ?? null)
				: today().toISOString();
	const nextDueAt =
		editingNextDueAt !== null
			? new Date(editingNextDueAt)
			: queuedNextDueAt !== null
				? new Date(queuedNextDueAt)
				: pending
					? new Date(pending.nextDueAt)
					: addMonths(new Date(startsAt ?? Date.now()), intervalMonths);
	return { startsAt, nextDueAt };
}

/** True while booking this due date of the template is already waiting in the offline queue. */
export function isRecurringBookingQueued(
	queue: readonly OfflineAction[],
	target: { wgId: string; shareCode: string; memberId: string },
	template: { id: string; nextDueAt: string },
): boolean {
	return queue.some(
		(action) =>
			action.shareCode === target.shareCode &&
			action.memberId === target.memberId &&
			(action.wgId === undefined || action.wgId === target.wgId) &&
			(action.type === 'expense.create' || action.type === 'recurring.advance') &&
			action.payload.recurringExpenseId === template.id &&
			action.payload.expectedRecurringNextDueAt === template.nextDueAt,
	);
}
