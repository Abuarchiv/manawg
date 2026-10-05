import { db, idempotencyResponses } from '@/core/db';
import type { DbTransaction } from '@/core/db/transaction';
import { logApiError } from '@/core/infra/observability';
import { RESPONSE_REPLAY_TTL_SECONDS } from '@/core/offline/replay-retention';
import { and, eq, sql } from 'drizzle-orm';

/** Replace the claim placeholder with the final response inside the mutation's transaction. */
export async function completeClaimedResponse(
	tx: DbTransaction,
	scope: string,
	key: string,
	responseBody: object,
): Promise<boolean> {
	const rows = await tx
		.update(idempotencyResponses)
		.set({
			responseBody,
			expiresAt: new Date(Date.now() + RESPONSE_REPLAY_TTL_SECONDS * 1000),
		})
		.where(
			and(
				eq(idempotencyResponses.scope, scope),
				eq(idempotencyResponses.key, key),
				sql`${idempotencyResponses.responseBody} @> '{"_claimed": true}'::jsonb`,
			),
		)
		.returning({ scope: idempotencyResponses.scope });
	return rows.length > 0;
}

/**
 * Delete the claim placeholder after its mutation rolled back, so a retry with
 * the same Idempotency-Key runs at once instead of waiting out the lease.
 *
 * Only the placeholder this request locked (identified by its lease expiry) is
 * removed; a completed response or a newer claim by another request stays.
 * Runs outside the rolled-back transaction and never throws: a failed release
 * only costs the retry a wait.
 */
export async function releaseClaimedResponse(
	scope: string,
	key: string,
	leaseExpiresAt: Date,
): Promise<void> {
	try {
		await db
			.delete(idempotencyResponses)
			.where(
				and(
					eq(idempotencyResponses.scope, scope),
					eq(idempotencyResponses.key, key),
					eq(idempotencyResponses.expiresAt, leaseExpiresAt),
					sql`${idempotencyResponses.responseBody} = '{"_claimed":true}'::jsonb`,
				),
			);
	} catch (err) {
		logApiError('[idempotency] claim release failed', err);
	}
}
