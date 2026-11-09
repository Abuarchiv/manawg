import 'server-only';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import {
	type ExpenseShare,
	expenseDeletionNotices,
	expenseUpdateNotices,
} from '../expense-change-notices';

interface NotifyBase {
	wg: { id: string; name: string; shareCode: string };
	actor: { memberId: string; name: string };
	title: string;
	currency: string;
}

/** Tells the members whose share changed that the expense was edited; one push per distinct share change. */
export async function notifyExpenseUpdated(
	input: NotifyBase & {
		expenseId: string;
		before: { amountCents: number; occurredAt: Date; shares: ExpenseShare[] };
		after: { amountCents: number; occurredAt: Date; shares: ExpenseShare[] };
	},
): Promise<void> {
	const notices = expenseUpdateNotices({
		actorId: input.actor.memberId,
		before: input.before,
		after: input.after,
	});
	await Promise.all(
		notices.map((notice) =>
			dispatchNotificationSafely({
				wg: input.wg,
				event: 'expense.updated',
				payload: {
					actorName: input.actor.name,
					title: input.title,
					currency: input.currency,
					expenseId: input.expenseId,
					shareFromCents: notice.fromCents,
					shareToCents: notice.toCents,
				},
				targetMemberIds: notice.memberIds,
				excludeMemberId: input.actor.memberId,
			}),
		),
	);
}

/** Tells the members whose balance the deleted expense moved. */
export async function notifyExpenseDeleted(
	input: NotifyBase & { payerId: string; shares: ExpenseShare[] },
): Promise<void> {
	const notices = expenseDeletionNotices({
		actorId: input.actor.memberId,
		payerId: input.payerId,
		shares: input.shares,
	});
	await Promise.all(
		notices.map((notice) =>
			dispatchNotificationSafely({
				wg: input.wg,
				event: 'expense.deleted',
				payload: {
					actorName: input.actor.name,
					title: input.title,
					currency: input.currency,
					amountCents: notice.amountCents,
				},
				targetMemberIds: notice.memberIds,
				excludeMemberId: input.actor.memberId,
			}),
		),
	);
}
