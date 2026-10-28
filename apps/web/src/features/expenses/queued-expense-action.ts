import {
	createQueuedExpense,
	createQueuedExpenseUpdate,
	type OfflineAction,
} from '@/core/offline/offline-queue';
import { withQueuedOccurredAt } from '@/features/expenses/queued-occurred-at';

type QueuedExpenseFields = Omit<
	Parameters<typeof createQueuedExpense>[0],
	'idempotencyKey' | 'recurringExpenseId' | 'expectedRecurringNextDueAt' | 'now'
>;

/**
 * The offline-queue action for a save that could not reach the server: an update of
 * `edit.expenseId`, or a new expense stamped with its day (today when `occurredAt` is null).
 */
export function buildQueuedExpenseAction(input: {
	fields: QueuedExpenseFields;
	occurredAt: string | null;
	edit: { expenseId: string; expectedUpdatedAt: string } | null;
	idempotencyKey: string | null;
	recurring: { recurringExpenseId?: string; expectedRecurringNextDueAt?: string };
}): OfflineAction {
	const { fields, occurredAt, edit, idempotencyKey, recurring } = input;
	if (edit) {
		return withQueuedOccurredAt(createQueuedExpenseUpdate({ ...fields, ...edit }), occurredAt);
	}
	return withQueuedOccurredAt(
		createQueuedExpense({
			...fields,
			...(idempotencyKey ? { idempotencyKey } : {}),
			...recurring,
		}),
		occurredAt ?? new Date().toISOString(),
	);
}
