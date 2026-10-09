import {
	type OfflineAction,
	createOfflineIdempotencyKey,
	isOfflineIdempotencyKey,
} from './offline-action';

/**
 * Builders for queued actions. The id encodes type, WG, time and target; the server never issues
 * such ids, so a row carrying one is known to be local-only.
 */

interface QueuedIdentityInput {
	wgId?: string;
	shareCode: string;
	memberId: string;
}

interface QueuedShoppingInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	name: string;
	quantity: string | null;
	now?: number;
}

interface QueuedShoppingUpdateInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	itemId: string;
	name: string;
	bought: boolean;
	expectedUpdatedAt: string;
	expectedBoughtAt: string | null;
	now?: number;
}

interface QueuedAnnouncementInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	content: string;
	kind: string;
	imageUrl?: string | null;
	now?: number;
}

interface QueuedChoreCompletionInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	choreId: string;
	expectedNextDueAt: string;
	expectedAssignedMemberId: string | null;
	now?: number;
}

interface QueuedChoreInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	title: string;
	recurrenceType?: 'days' | 'months';
	intervalDays: number;
	assignedMemberId: string | null;
	now?: number;
}

interface QueuedAbsenceInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	absenceMemberId: string;
	startDate: string;
	endDate: string;
	reason: string | null;
	now?: number;
}

interface QueuedExpenseInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	description: string;
	amountCents: number;
	paidByMemberId: string;
	splits: Array<{ debtorMemberId: string; amountCents: number }>;
	imageUrl?: string | null;
	/** Back-dated expenses keep their date, so the replay sends the original body. */
	occurredAt?: string;
	recurringExpenseId?: string;
	expectedRecurringNextDueAt?: string;
	now?: number;
}

interface QueuedExpenseUpdateInput extends QueuedExpenseInput {
	expenseId: string;
	expectedUpdatedAt: string;
}

interface QueuedRecurringInput extends QueuedIdentityInput {
	idempotencyKey?: string;
	description: string;
	amountCents: number;
	paidByMemberId: string;
	intervalMonths: number;
	nextDueAt: string;
	/** Unclamped start day; must replay unchanged with the same idempotency key. */
	anchorAt?: string;
	splits: Array<{ debtorMemberId: string; amountCents: number }>;
	now?: number;
}

function slug(value: string): string {
	return (
		value
			.trim()
			.toLocaleLowerCase('de-DE')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'item'
	);
}

function createQueuedAction(
	id: string,
	type: OfflineAction['type'],
	wgId: string | undefined,
	shareCode: string,
	memberId: string,
	payload: OfflineAction['payload'],
	now: number,
	idempotencyKeyOverride?: string,
): OfflineAction {
	const idempotencyKey = isOfflineIdempotencyKey(idempotencyKeyOverride)
		? idempotencyKeyOverride
		: createOfflineIdempotencyKey();
	return {
		id,
		...(idempotencyKey ? { idempotencyKey } : {}),
		type,
		...(wgId ? { wgId } : {}),
		shareCode,
		memberId,
		createdAt: new Date(now).toISOString(),
		payload,
	};
}

export function createQueuedShoppingItem(input: QueuedShoppingInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`shopping:${input.shareCode}:${now}:${slug(input.name)}`,
		'shopping.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{ name: input.name, quantity: input.quantity },
		now,
		input.idempotencyKey,
	);
}

export function createQueuedShoppingUpdate(input: QueuedShoppingUpdateInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`shopping-update:${input.shareCode}:${now}:${input.itemId}`,
		'shopping.update',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			itemId: input.itemId,
			name: input.name,
			bought: input.bought,
			expectedUpdatedAt: input.expectedUpdatedAt,
			expectedBoughtAt: input.expectedBoughtAt,
		},
		now,
		input.idempotencyKey,
	);
}

export function createQueuedAnnouncement(input: QueuedAnnouncementInput): OfflineAction {
	const now = input.now ?? Date.now();
	const action = createQueuedAction(
		`announcement:${input.shareCode}:${now}:${slug(input.content)}`,
		'announcement.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{ content: input.content, kind: input.kind, imageUrl: input.imageUrl ?? null },
		now,
	);
	return input.idempotencyKey && isOfflineIdempotencyKey(input.idempotencyKey)
		? { ...action, idempotencyKey: input.idempotencyKey }
		: action;
}

export function createQueuedChoreCompletion(input: QueuedChoreCompletionInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`chore:${input.shareCode}:${now}:${input.choreId}`,
		'chore.complete',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			choreId: input.choreId,
			expectedNextDueAt: input.expectedNextDueAt,
			expectedAssignedMemberId: input.expectedAssignedMemberId,
		},
		now,
		input.idempotencyKey,
	);
}

export function createQueuedChore(input: QueuedChoreInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`chore-create:${input.shareCode}:${now}:${slug(input.title)}`,
		'chore.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			title: input.title,
			intervalDays: input.intervalDays,
			recurrenceType: input.recurrenceType ?? 'days',
			assignedMemberId: input.assignedMemberId,
		},
		now,
		input.idempotencyKey,
	);
}

export function createQueuedAbsence(input: QueuedAbsenceInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`absence:${input.shareCode}:${now}:${input.absenceMemberId}`,
		'absence.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			memberId: input.absenceMemberId,
			startDate: input.startDate,
			endDate: input.endDate,
			reason: input.reason,
		},
		now,
		input.idempotencyKey,
	);
}

export function createQueuedExpense(input: QueuedExpenseInput): OfflineAction {
	const now = input.now ?? Date.now();
	const action = createQueuedAction(
		`expense:${input.shareCode}:${now}:${slug(input.description)}`,
		'expense.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			description: input.description,
			amountCents: input.amountCents,
			paidByMemberId: input.paidByMemberId,
			splits: input.splits,
			imageUrl: input.imageUrl ?? null,
			...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
			...(input.recurringExpenseId ? { recurringExpenseId: input.recurringExpenseId } : {}),
			...(input.expectedRecurringNextDueAt
				? { expectedRecurringNextDueAt: input.expectedRecurringNextDueAt }
				: {}),
		},
		now,
	);
	return input.idempotencyKey && isOfflineIdempotencyKey(input.idempotencyKey)
		? { ...action, idempotencyKey: input.idempotencyKey }
		: action;
}

export function createQueuedExpenseUpdate(input: QueuedExpenseUpdateInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`expense-update:${input.shareCode}:${now}:${input.expenseId}`,
		'expense.update',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			expenseId: input.expenseId,
			expectedUpdatedAt: input.expectedUpdatedAt,
			description: input.description,
			amountCents: input.amountCents,
			paidByMemberId: input.paidByMemberId,
			splits: input.splits,
			imageUrl: input.imageUrl,
			...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
		},
		now,
	);
}

export function createQueuedRecurring(input: QueuedRecurringInput): OfflineAction {
	const now = input.now ?? Date.now();
	return createQueuedAction(
		`recurring:${input.shareCode}:${now}:${slug(input.description)}`,
		'recurring.create',
		input.wgId,
		input.shareCode,
		input.memberId,
		{
			description: input.description,
			amountCents: input.amountCents,
			paidByMemberId: input.paidByMemberId,
			intervalMonths: input.intervalMonths,
			nextDueAt: input.nextDueAt,
			...(input.anchorAt ? { anchorAt: input.anchorAt } : {}),
			splits: input.splits,
		},
		now,
		input.idempotencyKey,
	);
}
