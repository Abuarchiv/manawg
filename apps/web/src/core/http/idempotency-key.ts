/** Client-safe idempotency key lifecycle shared by every mutating call site. */

const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isIdempotencyKey(value: unknown): value is string {
	return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value);
}

/** A fresh UUID key, or null when `crypto.randomUUID` is unavailable or returns something odd. */
export function createIdempotencyKey(): string | null {
	try {
		const key = crypto.randomUUID();
		return isIdempotencyKey(key) ? key : null;
	} catch {
		return null;
	}
}

/** The key of a request that has been sent but not answered definitively yet. */
export interface PendingIdempotentRequest {
	fingerprint: string;
	key: string;
}

/**
 * Reuses the pending key for an identical retry (same fingerprint), otherwise makes a fresh one.
 * Null when no key can be made.
 * `createKey` is a seam for callers whose tests need predictable keys.
 */
export function resolveIdempotencyKey(
	pending: PendingIdempotentRequest | null | undefined,
	fingerprint: string,
	createKey: () => string | null = createIdempotencyKey,
): string | null {
	return pending?.fingerprint === fingerprint ? pending.key : createKey();
}

/**
 * A definitive answer: the request reached the server and a retry with the same key cannot
 * succeed. Rate limits (429), server errors and an in-flight duplicate keep the key, because no
 * route stores those outcomes for replay.
 */
export function shouldReleaseIdempotencyKey(status: number, error?: string | null): boolean {
	return status > 0 && status < 500 && status !== 429 && error !== 'idempotency_response_pending';
}
