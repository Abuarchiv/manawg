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
	createdAt: string;
	payload: Record<string, unknown>;
	attempts?: number;
	lastAttemptAt?: string;
	lastError?: string;
}

const OFFLINE_IDEMPOTENCY_KEY_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOfflineIdempotencyKey(value: unknown): value is string {
	return typeof value === 'string' && OFFLINE_IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function createOfflineIdempotencyKey(): string | null {
	try {
		const key = crypto.randomUUID();
		return isOfflineIdempotencyKey(key) ? key : null;
	} catch {
		return null;
	}
}
