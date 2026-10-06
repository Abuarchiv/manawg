import { db, idempotencyResponses } from '@/core/db';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { type SQL, and, eq, gt, lte, or, sql } from 'drizzle-orm';

// Response replay lives in Postgres, never in Redis: an empty UPSTASH_* configuration once let a
// silently disabled Redis client wave duplicate expense inserts through.

// A claim is only a lease. If the worker dies after inserting the placeholder, another retry
// must be able to reclaim it instead of being blocked for the whole offline replay window.
const RESPONSE_CLAIM_LEASE_SECONDS = 15 * 60;
const CLAIM_PLACEHOLDER = { _claimed: true };

export function readIdempotencyKey(req: Request): string | null {
	const raw = req.headers.get('idempotency-key');
	if (!raw) return null;
	const trimmed = raw.trim();
	// Idempotency keys are UUIDs; reuse the canonical shape check from api-auth.ts.
	if (!UUID_PATTERN.test(trimmed)) return null;
	return trimmed.toLowerCase();
}

/**
 * Atomically claims a response-replay slot in Postgres.
 *
 * Returns `true` when the caller won the slot and must perform the mutation and complete the
 * claim. Returns `false` when another request holds it; the caller must wait for and replay that
 * request's response. Two serverless instances racing on the same key collide on the
 * `(scope, key)` primary key, so only one wins the insert. An expired placeholder is reclaimed.
 *
 * Fail-closed: a DB error leaves claim ownership unknown and aborts the request, even if the
 * insert may have committed before the error.
 */
export async function claimResponseSlot(scope: string, key: string): Promise<boolean> {
	try {
		const rows = await db
			.insert(idempotencyResponses)
			.values({
				scope,
				key,
				responseBody: CLAIM_PLACEHOLDER,
				expiresAt: new Date(Date.now() + RESPONSE_CLAIM_LEASE_SECONDS * 1000),
			})
			.onConflictDoUpdate({
				target: [idempotencyResponses.scope, idempotencyResponses.key],
				set: {
					responseBody: CLAIM_PLACEHOLDER,
					expiresAt: new Date(Date.now() + RESPONSE_CLAIM_LEASE_SECONDS * 1000),
				},
				where: sql`${idempotencyResponses.expiresAt} <= now()`,
			})
			.returning({ scope: idempotencyResponses.scope });
		return rows.length > 0;
	} catch (err) {
		throw new Error('idempotency_claim_failed', { cause: err });
	}
}

/**
 * The stored response for `scope:key`, or `null` when none is stored yet (no row, an expired row
 * or a still-pending claim placeholder).
 *
 * Fail-closed: a DB error aborts the request, because an unavailable store is not evidence of a
 * missing response. A response that was too large to keep throws
 * `idempotency_response_unavailable`, so a retry fails loudly instead of writing twice.
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
		if (first.body && typeof first.body === 'object' && '_claimed' in first.body) {
			// The claim lease is represented by expiresAt. A stale placeholder is invisible to
			// readers and can be reclaimed by claimResponseSlot.
			return null;
		}
		if (
			first.body &&
			typeof first.body === 'object' &&
			'_replayUnavailable' in first.body &&
			(first.body as { _replayUnavailable?: unknown })._replayUnavailable === true
		) {
			throw new Error('idempotency_response_unavailable');
		}
		return first.body as T;
	} catch (err) {
		throw new Error('idempotency_cache_read_failed', { cause: err });
	}
}

/** Where a post-commit warning lands in a stored response, and which row it belongs to. */
export interface ReplayWarningTarget {
	/** Text values the stored response must hold at these JSON paths, e.g. the created row's id. */
	match: ReadonlyArray<{ path: readonly string[]; equals: string }>;
	/** JSON path of the warning field inside the stored response. */
	warningPath: readonly string[];
	/** Warning values the update may overwrite. */
	replaces: ReadonlyArray<string | null>;
}

/** A JSON path literal; the segments are code constants, never request data. */
function jsonPath(path: readonly string[]): SQL {
	if (!path.every((segment) => /^[A-Za-z_]+$/.test(segment))) {
		throw new Error('replay_warning_path_invalid');
	}
	return sql.raw(`'{${path.join(',')}}'`);
}

function jsonText(value: string | null): SQL {
	return value === null ? sql`'null'::jsonb` : sql`to_jsonb(${value}::text)`;
}

/**
 * Write a warning that only became known after commit (e.g. a failed push) into the stored
 * response, so a replay reports it too. Only the still-valid response of the expected row is
 * touched. Resolves to whether exactly that response was updated.
 */
export async function setReplayWarning(
	scope: string,
	key: string,
	target: ReplayWarningTarget,
	warning: string | null,
): Promise<boolean> {
	const body = idempotencyResponses.responseBody;
	const warningPath = jsonPath(target.warningPath);
	const rows = await db
		.update(idempotencyResponses)
		.set({
			responseBody: sql`jsonb_set(${body}, ${warningPath}, ${jsonText(warning)})`,
		})
		.where(
			and(
				eq(idempotencyResponses.scope, scope),
				eq(idempotencyResponses.key, key),
				gt(idempotencyResponses.expiresAt, new Date()),
				...target.match.map(({ path, equals }) => sql`${body} #>> ${jsonPath(path)} = ${equals}`),
				or(...target.replaces.map((value) => sql`${body} #> ${warningPath} = ${jsonText(value)}`)),
			),
		)
		.returning({ scope: idempotencyResponses.scope });
	return rows.length === 1;
}

/**
 * Deletes idempotency rows whose `expiresAt` has passed.
 *
 * Readers already ignore expired rows; this keeps the table from growing without bound. Runs from
 * the maintenance cron; the `idempotency_responses_expires_idx` index keeps the delete cheap.
 */
export async function purgeExpiredIdempotencyResponses(now: Date = new Date()): Promise<number> {
	const deleted = await db
		.delete(idempotencyResponses)
		.where(lte(idempotencyResponses.expiresAt, now))
		.returning({ key: idempotencyResponses.key });
	return deleted.length;
}
