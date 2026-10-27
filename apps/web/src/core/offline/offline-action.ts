/** The shape every offline action shares, persisted as JSON in local storage. */
export type OfflineActionType =
	| 'shopping.create'
	| 'shopping.update'
	| 'announcement.create'
	| 'absence.create'
	| 'chore.create'
	| 'chore.complete'
	| 'expense.create'
	| 'expense.update'
	| 'recurring.create'
	| 'recurring.advance';

export interface OfflineAction {
	id: string;
	/** Stable UUID used exclusively for server-side replay protection. */
	idempotencyKey?: string;
	type: OfflineActionType;
	wgId?: string;
	shareCode: string;
	memberId: string;
	/** Account that queued the action; missing on entries from before account binding. */
	authUserId?: string;
	createdAt: string;
	payload: Record<string, unknown>;
	attempts?: number;
	lastAttemptAt?: string;
	lastError?: string;
}

export {
	createIdempotencyKey as createOfflineIdempotencyKey,
	isIdempotencyKey as isOfflineIdempotencyKey,
} from '@/core/http/idempotency-key';
