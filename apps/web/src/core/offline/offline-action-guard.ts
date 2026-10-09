import { isRecord } from '@/core/utils/is-record';
import type { OfflineAction, OfflineActionType } from './offline-queue';

/** Shape checks for queue entries read back from local storage, which any app version may have written. */

const OFFLINE_ACTION_TYPES: ReadonlySet<OfflineActionType> = new Set([
	'shopping.create',
	'shopping.update',
	'announcement.create',
	'absence.create',
	'chore.create',
	'chore.complete',
	'expense.create',
	'expense.update',
	'recurring.create',
	'recurring.advance',
]);

function isStringOrNull(value: unknown): value is string | null {
	return typeof value === 'string' || value === null;
}

function isOptionalStringOrNull(value: unknown): value is string | null | undefined {
	return value === undefined || isStringOrNull(value);
}

function isSplitArray(
	value: unknown,
): value is Array<{ debtorMemberId: string; amountCents: number }> {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every(
			(split) =>
				isRecord(split) &&
				typeof split.debtorMemberId === 'string' &&
				typeof split.amountCents === 'number',
		)
	);
}

function hasValidPayload(type: OfflineActionType, payload: Record<string, unknown>): boolean {
	switch (type) {
		case 'shopping.create':
			return (
				typeof payload.name === 'string' &&
				isOptionalStringOrNull(payload.quantity) &&
				(payload.bought === undefined || typeof payload.bought === 'boolean')
			);
		case 'shopping.update':
			return (
				typeof payload.itemId === 'string' &&
				typeof payload.name === 'string' &&
				typeof payload.bought === 'boolean'
			);
		case 'announcement.create':
			return (
				typeof payload.content === 'string' &&
				typeof payload.kind === 'string' &&
				isOptionalStringOrNull(payload.imageUrl)
			);
		case 'absence.create':
			return (
				typeof payload.memberId === 'string' &&
				typeof payload.startDate === 'string' &&
				typeof payload.endDate === 'string' &&
				isOptionalStringOrNull(payload.reason)
			);
		case 'chore.create':
			return (
				typeof payload.title === 'string' &&
				typeof payload.intervalDays === 'number' &&
				isOptionalStringOrNull(payload.assignedMemberId)
			);
		case 'chore.complete':
			return typeof payload.choreId === 'string';
		case 'expense.create':
			return (
				typeof payload.description === 'string' &&
				typeof payload.amountCents === 'number' &&
				typeof payload.paidByMemberId === 'string' &&
				isSplitArray(payload.splits) &&
				isOptionalStringOrNull(payload.imageUrl) &&
				(payload.occurredAt === undefined || typeof payload.occurredAt === 'string')
			);
		case 'expense.update':
			return (
				typeof payload.expenseId === 'string' &&
				typeof payload.expectedUpdatedAt === 'string' &&
				typeof payload.description === 'string' &&
				typeof payload.amountCents === 'number' &&
				typeof payload.paidByMemberId === 'string' &&
				isSplitArray(payload.splits) &&
				isOptionalStringOrNull(payload.imageUrl) &&
				(payload.occurredAt === undefined || typeof payload.occurredAt === 'string')
			);
		case 'recurring.create':
			return (
				typeof payload.description === 'string' &&
				typeof payload.amountCents === 'number' &&
				typeof payload.paidByMemberId === 'string' &&
				typeof payload.intervalMonths === 'number' &&
				typeof payload.nextDueAt === 'string' &&
				(payload.anchorAt === undefined || typeof payload.anchorAt === 'string') &&
				isSplitArray(payload.splits)
			);
		case 'recurring.advance':
			return (
				typeof payload.recurringExpenseId === 'string' &&
				typeof payload.expectedRecurringNextDueAt === 'string'
			);
	}
}

export function isOfflineAction(value: unknown): value is OfflineAction {
	if (!isRecord(value)) return false;
	if (
		typeof value.id !== 'string' ||
		typeof value.type !== 'string' ||
		typeof value.shareCode !== 'string' ||
		typeof value.memberId !== 'string' ||
		typeof value.createdAt !== 'string' ||
		!isRecord(value.payload)
	) {
		return false;
	}
	if (value.wgId !== undefined && typeof value.wgId !== 'string') return false;
	const type = value.type as OfflineActionType;
	return OFFLINE_ACTION_TYPES.has(type) && hasValidPayload(type, value.payload);
}
