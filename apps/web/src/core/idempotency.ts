import { db, idempotencyResponses } from '@/core/db';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { createConfiguredRedis } from '@/core/rate-limit';
import { and, eq, gt } from 'drizzle-orm';

// Redis is OPTIONAL — only used for audit-event dedup (claimIdempotencySlot).
// Response-replay (getCachedResponse/setCachedResponse) ALWAYS uses Postgres
// because prod env has empty UPSTASH_* strings and silent disablement caused
// duplicate expense inserts (iter 13 outage).
const redis = createConfiguredRedis();

// Queued offline writes can be retried days after a lost response, so the
// durable response cache must outlive the retry window. Redis still only
// deduplicates best-effort audit events briefly.
const RESPONSE_REPLAY_TTL_SECONDS = 7 * 24 * 60 * 60;
const AUDIT_DEDUP_TTL_SECONDS = 5 * 60;
// Cap the cached payload to avoid blowing storage if a route accidentally
// stuffs huge JSON. 32 KiB easily covers an expense + 50 splits.
const MAX_CACHED_RESPONSE_BYTES = 32 * 1024;
const CLAIM_PLACEHOLDER = { _claimed: true };

export function readIdempotencyKey(req: Request): string | null {
	const raw = req.headers.get('idempotency-key');
	if (!raw) return null;
	const trimmed = raw.trim();
	// Idempotency keys are UUIDs — reuse the canonical UUID shape check
	// (api-auth.ts) instead of an independently maintained copy.
	if (!UUID_PATTERN.test(trimmed)) return null;
	return trimmed.toLowerCase();
}

/**
 * Atomically claims a response-replay slot in Postgres.
 *
 * Returns `true` when the caller won the slot and MUST perform the mutation
 * then call `setCachedResponse`. Returns `false` when another process already
 * claimed it — caller MUST fetch the cached response and return it verbatim.
 *
 * This is the cross-process safety net for serverless: two cold Lambdas
 * receiving the same Idempotency-Key simultaneously will race on the
 * (scope, key) primary key, and only one wins the insert.
 *
 * Fail-open: a DB error returns `true` so the request still succeeds.
 */
export async function claimResponseSlot(scope: string, key: string): Promise<boolean> {
	try {
		const rows = await db
			.insert(idempotencyResponses)
			.values({
				scope,
				key,
				responseBody: CLAIM_PLACEHOLDER,
				expiresAt: new Date(Date.now() + RESPONSE_REPLAY_TTL_SECONDS * 1000),
			})
			.onConflictDoNothing()
			.returning({ scope: idempotencyResponses.scope });
		return rows.length > 0;
	} catch (err) {
		console.error('[idempotency] claimResponseSlot failed, failing open:', err);
		return true;
	}
}

/**
 * Atomically claims an idempotency slot for `scope:key` with a 5-minute TTL.
 *
 * Returns `true` when the caller "won" the slot and should perform the
 * non-idempotent side effect (e.g. recording an audit event). Returns `false`
 * when the slot was already taken — caller MUST skip the side effect.
 *
 * Fail-open: a Redis error returns `true` so the underlying request still
 * succeeds. Audit dedup is best-effort, not a correctness requirement.
 */
export async function claimIdempotencySlot(scope: string, key: string): Promise<boolean> {
	if (!redis) return true;
	try {
		const result = await redis.set(`manawg:idem:${scope}:${key}`, '1', {
			nx: true,
			ex: AUDIT_DEDUP_TTL_SECONDS,
		});
		// Upstash returns 'OK' when the key was set, null when NX rejected it.
		return result === 'OK';
	} catch (err) {
		console.error('[idempotency] redis claim failed, failing open:', err);
		return true;
	}
}

/**
 * Look up a previously cached response payload for `scope:key`. Returns the
 * parsed JSON body when a prior request stored one, `null` otherwise.
 *
 * Used by routes that need true response-replay semantics (e.g. POST
 * /expenses where the client expects the SAME expense.id on retry to avoid
 * duplicate inserts on flaky mobile networks).
 *
 * Postgres-backed (not Redis) because prod has empty UPSTASH_* env vars and
 * the silent-disablement caused duplicate expense inserts.
 *
 * Fail-closed: a DB error returns `null` so the route falls through to normal
 * processing — a temporary hiccup must never trigger a double-mutation.
 */
export async function getCachedResponse<T>(scope: string, key: string): Promise<T | null> {
	try {
		const rows = await db
			.select({ body: idempotencyResponses.responseBody })
			.from(idempotencyResponses)
			.where(
				and(
					eq(idempotencyResponses.scope, scope),
					eq(idempotencyResponses.key, key),
					gt(idempotencyResponses.expiresAt, new Date()),
				),
			)
			.limit(1);
		const first = rows[0];
		if (!first) return null;
		if (
			first.body &&
			typeof first.body === 'object' &&
			'_claimed' in first.body &&
			(first.body as { _claimed?: unknown })._claimed === true
		) {
			return null;
		}
		return first.body as T;
	} catch (err) {
		console.error('[idempotency] db getCachedResponse failed, failing closed:', err);
		return null;
	}
}

/**
 * Cache a response payload under `scope:key` for the seven-day offline retry window.
 * Silently drops payloads larger than 32 KiB so a misbehaving caller cannot
 * exhaust storage. `ON CONFLICT DO UPDATE` replaces a temporary claim marker
 * written by `claimResponseSlot` with the real response body.
 */
export async function setCachedResponse(
	scope: string,
	key: string,
	payload: unknown,
): Promise<void> {
	try {
		const serialized = JSON.stringify(payload);
		if (serialized.length > MAX_CACHED_RESPONSE_BYTES) {
			console.warn(
				`[idempotency] payload for ${scope}:${key} exceeds ${MAX_CACHED_RESPONSE_BYTES} bytes, skipping cache`,
			);
			return;
		}
		await db
			.insert(idempotencyResponses)
			.values({
				scope,
				key,
				responseBody: payload as object,
				expiresAt: new Date(Date.now() + RESPONSE_REPLAY_TTL_SECONDS * 1000),
			})
			.onConflictDoUpdate({
				target: [idempotencyResponses.scope, idempotencyResponses.key],
				set: {
					responseBody: payload as object,
					expiresAt: new Date(Date.now() + RESPONSE_REPLAY_TTL_SECONDS * 1000),
				},
			});
	} catch (err) {
		console.error('[idempotency] db setCachedResponse failed:', err);
	}
}
