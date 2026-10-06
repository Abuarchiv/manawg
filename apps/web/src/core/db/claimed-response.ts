import { db, idempotencyResponses } from '@/core/db';
import type { DbTransaction } from '@/core/db/transaction';
import { TransactionAbort } from '@/core/db/transaction-abort';
import { logApiError } from '@/core/infra/observability';
import { RESPONSE_REPLAY_TTL_SECONDS } from '@/core/offline/replay-retention';
import { and, eq, sql } from 'drizzle-orm';

/**
 * Shared claim protocol for mutations that accept an `Idempotency-Key`.
 *
 * `claimResponseSlot` stores the placeholder `{"_claimed":true}` with a short
 * lease. The mutation's transaction then locks the row, writes, and replaces
 * the placeholder with its response; a rolled-back mutation deletes it again.
 * Every step matches the placeholder by jsonb equality and the lease it
 * locked, so a request whose lease ran out can never complete or delete the
 * claim (or response) of the request that took the key over.
 */

export type LockedClaim<T> =
	| { kind: 'claimed'; leaseExpiresAt: Date }
	| { kind: 'completed'; body: T };

function isClaimPlaceholder(body: unknown): boolean {
	return (
		body !== null &&
		typeof body === 'object' &&
		!Array.isArray(body) &&
		Object.keys(body).length === 1 &&
		(body as { _claimed?: unknown })._claimed === true
	);
}

function placeholderBody() {
	return sql`${idempotencyResponses.responseBody} = '{"_claimed":true}'::jsonb`;
}

/**
 * Lock the claim row for the rest of the transaction.
 *
 * Returns the stored response when another request already completed the key,
 * otherwise the lease of the still-valid placeholder for completion and
 * release. A missing row or an expired or foreign body aborts the transaction.
 */
export async function lockClaimedResponse<T>(
	tx: DbTransaction,
	scope: string,
	key: string,
	isCompleted: (body: unknown) => body is T,
): Promise<LockedClaim<T>> {
	const [slot] = await tx
		.select({ body: idempotencyResponses.responseBody, expiresAt: idempotencyResponses.expiresAt })
		.from(idempotencyResponses)
		.where(and(eq(idempotencyResponses.scope, scope), eq(idempotencyResponses.key, key)))
		.limit(1)
		.for('update');
	if (!slot) throw new TransactionAbort('idempotency_claim_missing');
	if (isCompleted(slot.body)) return { kind: 'completed', body: slot.body };
	if (!isClaimPlaceholder(slot.body) || !(slot.expiresAt > new Date())) {
		throw new TransactionAbort('idempotency_claim_invalid');
	}
	return { kind: 'claimed', leaseExpiresAt: slot.expiresAt };
}

/**
 * Replace the claim placeholder with the final response inside the mutation's
 * transaction and keep it for replays.
 *
 * Pass the lease from `lockClaimedResponse`; only routes that never lock the
 * row (`withIdempotentJsonResponse`) complete without one. Aborts the
 * transaction when the placeholder is gone, expired or held by another lease.
 */
export async function completeClaimedResponse(
	tx: DbTransaction,
	scope: string,
	key: string,
	responseBody: object,
	leaseExpiresAt?: Date,
): Promise<void> {
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
				placeholderBody(),
				sql`${idempotencyResponses.expiresAt} > now()`,
				leaseExpiresAt ? eq(idempotencyResponses.expiresAt, leaseExpiresAt) : undefined,
			),
		)
		.returning({ scope: idempotencyResponses.scope });
	if (rows.length !== 1) throw new TransactionAbort('idempotency_claim_missing');
}

/**
 * Delete the locked placeholder inside a transaction that commits without a
 * stored response (a rejected write such as a rate limit), so the same key can
 * run again. Aborts the transaction when the placeholder is no longer ours.
 */
export async function releaseLockedClaim(
	tx: DbTransaction,
	scope: string,
	key: string,
	leaseExpiresAt: Date,
): Promise<void> {
	const rows = await tx
		.delete(idempotencyResponses)
		.where(
			and(
				eq(idempotencyResponses.scope, scope),
				eq(idempotencyResponses.key, key),
				eq(idempotencyResponses.expiresAt, leaseExpiresAt),
				placeholderBody(),
			),
		)
		.returning({ scope: idempotencyResponses.scope });
	if (rows.length !== 1) throw new TransactionAbort('idempotency_claim_missing');
}

/**
 * Delete the claim placeholder after its mutation rolled back, so a retry with
 * the same Idempotency-Key runs at once instead of waiting out the lease.
 *
 * Only the placeholder this request locked (identified by its lease expiry) is
 * removed; a completed response or a newer claim by another request stays.
 * Runs outside the rolled-back transaction and never throws: a failed release
 * only costs the retry a wait. Resolves to whether the placeholder was removed.
 */
export async function releaseClaimedResponse(
	scope: string,
	key: string,
	leaseExpiresAt: Date,
): Promise<boolean> {
	try {
		const rows = await db
			.delete(idempotencyResponses)
			.where(
				and(
					eq(idempotencyResponses.scope, scope),
					eq(idempotencyResponses.key, key),
					eq(idempotencyResponses.expiresAt, leaseExpiresAt),
					placeholderBody(),
				),
			)
			.returning({ scope: idempotencyResponses.scope });
		return rows.length > 0;
	} catch (err) {
		logApiError('[idempotency] claim release failed', err);
		return false;
	}
}
