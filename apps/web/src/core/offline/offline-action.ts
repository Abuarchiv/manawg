import type { Message } from '@/shared/i18n/message';

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
	/** Diagnostic text of the last failure; the review and connection prefixes are matched by older builds. */
	lastError?: string;
	/** The last failure as a message, rendered in the reader's language. */
	lastErrorMessage?: Message;
	/** Sync will not retry this action: a person has to look at it first. */
	needsReview?: 'server' | 'imageMissing' | 'imageRemoved';
	/** The last attempt did not reach the server. */
	noConnection?: true;
}
