import { claimResponseSlot, getCachedResponse } from '@/core/idempotency';

// Poll up to ~10s with backoff. A slow first winner (cold lambda, slow DB)
// must not make the retrying loser act as a new winner — that would insert
// twice despite the shared Idempotency-Key. 100ms flat was ~1.1s total, well
// under realistic handler durations.
const POLL_ATTEMPTS = 14;
const POLL_INTERVAL_MS = 100;
const POLL_MAX_INTERVAL_MS = 2000;

type ReplayEntry<T> = {
	expiresAt: number;
	promise: Promise<T>;
};

export type ReplayReservation<T> =
	| {
			owned: true;
			resolve: (body: T) => void;
			reject: (reason: unknown) => void;
	  }
	| {
			owned: false;
			promise: Promise<T>;
	  };

/**
 * In-process (single warm-Lambda-instance) response-replay cache, keyed by
 * an arbitrary string. Deduplicates concurrent requests that land on the
 * SAME instance while the first is still writing — the first caller
 * "reserves" the key and every other caller on this instance gets its
 * eventual response instead of racing it into a second write.
 *
 * This is deliberately separate from (and faster than) the cross-process
 * Postgres claim in {@link claimReplaySlotWithRetry} below, which covers
 * the case where the duplicate request lands on a *different* Lambda
 * instance. Both layers are required — see the "RED BUG-002" test in
 * expenses/route.test.ts, which exercises the local-map layer even when
 * the Postgres cache read is stale/null.
 *
 * Extracted verbatim (semantics unchanged) from the hand-rolled
 * `expenseCreateReplay` Map in expenses/route.ts so both the expenses and
 * recurring-expenses routes can share one reservation implementation.
 */
export class ReplayCache<T> {
	private readonly entries = new Map<string, ReplayEntry<T>>();

	constructor(private readonly ttlMs: number) {}

	get(cacheKey: string): Promise<T> | null {
		const entry = this.entries.get(cacheKey);
		if (!entry) return null;
		if (entry.expiresAt <= Date.now()) {
			this.entries.delete(cacheKey);
			return null;
		}
		return entry.promise;
	}

	remember(cacheKey: string, body: T): void {
		this.entries.set(cacheKey, {
			expiresAt: Date.now() + this.ttlMs,
			promise: Promise.resolve(body),
		});
	}

	/**
	 * Claim the local reservation for `cacheKey`, or return the existing
	 * in-flight/resolved promise if another caller already owns it.
	 */
	reserve(cacheKey: string): ReplayReservation<T> {
		const existing = this.get(cacheKey);
		if (existing) return { owned: false, promise: existing };

		// The Promise executor runs synchronously, so `resolveFn`/`rejectFn`
		// are always reassigned to the real callbacks before this line
		// finishes — no non-null assertion needed to use them below.
		let resolveFn: (body: T) => void = () => undefined;
		let rejectFn: (reason: unknown) => void = () => undefined;
		const promise = new Promise<T>((promiseResolve, promiseReject) => {
			resolveFn = promiseResolve;
			rejectFn = promiseReject;
		});
		// A reservation that is ultimately rejected must not surface as an
		// unhandled rejection — the route's own catch handles reporting.
		promise.catch(() => undefined);

		this.entries.set(cacheKey, { expiresAt: Date.now() + this.ttlMs, promise });
		return {
			owned: true,
			resolve: (body) => {
				this.remember(cacheKey, body);
				resolveFn(body);
			},
			reject: (reason) => {
				this.entries.delete(cacheKey);
				rejectFn(reason);
			},
		};
	}
}

/** Namespaces a raw Idempotency-Key header value under a caller-chosen scope. */

export function replayKey(scope: string, key: string): string {
	return `${scope}:${key}`;
}

type ReplaySlotResult<T> = { won: true } | { won: false; cached: T | null };

/**
 * Cross-process response-replay claim with poll-and-retry, backed by the
 * Postgres claim table in `@/core/idempotency` (deliberately not Redis — see
 * that module's doc comment re: the iter 13 P0 outage where an empty-env
 * Redis client silently no-opped and let duplicate expense inserts through).
 *
 * Attempts to claim the (scope, key) slot. If lost, checks once immediately
 * (the winner may already be done), then polls every 100ms up to 10 times.
 * Returns:
 *   - `{ won: true }` — caller should perform the mutation and eventually
 *     call `setCachedResponse`.
 *   - `{ won: false, cached: T }` — a completed response to replay as-is.
 *   - `{ won: false, cached: null }` — the other process appears to have
 *     failed (claim never resolved to a cached body); caller falls through
 *     and acts as the new winner.
 *
 * Extracted verbatim (semantics, call sequence, and timing unchanged) from
 * the POST handler in expenses/route.ts.
 */
export async function claimReplaySlotWithRetry<T>(
	scope: string,
	key: string,
): Promise<ReplaySlotResult<T>> {
	const won = await claimResponseSlot(scope, key);
	if (won) return { won: true };

	const immediate = await getCachedResponse<T>(scope, key);
	if (immediate) return { won: false, cached: immediate };

	let delay = POLL_INTERVAL_MS;
	for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, delay));
		delay = Math.min(delay * 2, POLL_MAX_INTERVAL_MS);
		const retried = await getCachedResponse<T>(scope, key);
		if (retried) return { won: false, cached: retried };
	}
	return { won: false, cached: null };
}
