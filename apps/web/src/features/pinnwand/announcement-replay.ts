import { db, idempotencyResponses } from '@/core/db';
import {
	completeClaimedResponse,
	lockClaimedResponse,
	releaseClaimedResponse,
	releaseLockedClaim,
} from '@/core/db/claimed-response';
import {
	type DbTransaction,
	TransactionAbort,
	lockExpensePayments,
	withTransaction,
} from '@/core/db/transaction';
import { claimReplaySlotWithRetry } from '@/core/guards/idempotency';
import { getCachedResponse, readIdempotencyKey } from '@/core/idempotency-store';
import { and, eq, gt, sql } from 'drizzle-orm';

export interface AnnouncementReplayResponse {
	status: number;
	body: unknown;
	entityId?: string;
}

export interface AnnouncementMutation<T> {
	response: AnnouncementReplayResponse;
	effect: T | null;
}

function isCompletedResponse(value: unknown): value is AnnouncementReplayResponse {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Number.isInteger((value as AnnouncementReplayResponse).status) &&
		(value as AnnouncementReplayResponse).status >= 200 &&
		(value as AnnouncementReplayResponse).status < 600 &&
		'body' in value
	);
}

export async function withAnnouncementReplay<T>(
	req: Request,
	scope: string,
	mutate: (tx: DbTransaction) => Promise<AnnouncementMutation<T>>,
	legacyResponse?: (value: unknown) => AnnouncementReplayResponse | null,
	wgId?: string,
): Promise<AnnouncementMutation<T> & { key: string | null }> {
	const key = readIdempotencyKey(req);
	const completedResponse = (value: unknown): AnnouncementReplayResponse | null =>
		isCompletedResponse(value) ? value : (legacyResponse?.(value) ?? null);
	const isReplayable = (value: unknown): value is unknown => completedResponse(value) !== null;
	if (key) {
		const cached = await getCachedResponse<AnnouncementReplayResponse>(scope, key);
		if (cached) {
			const response = completedResponse(cached);
			if (!response) throw new Error('idempotency_claim_invalid');
			return { response, effect: null, key };
		}
		const slot = await claimReplaySlotWithRetry<AnnouncementReplayResponse>(scope, key);
		if (!slot.won) {
			const response = completedResponse(slot.cached);
			if (!response) throw new Error('idempotency_claim_invalid');
			return { response, effect: null, key };
		}
	}

	let lockedClaimExpiry: Date | null = null;
	let callbackFailure: unknown;
	let failedInCallback = false;
	let result: AnnouncementMutation<T>;
	try {
		result = await withTransaction(async (tx) => {
			try {
				if (wgId) await lockExpensePayments(tx, wgId);
				if (key) {
					const claim = await lockClaimedResponse(tx, scope, key, isReplayable);
					if (claim.kind === 'completed') {
						const response = completedResponse(claim.body);
						if (!response) throw new TransactionAbort('idempotency_claim_invalid');
						return { response, effect: null };
					}
					lockedClaimExpiry = claim.leaseExpiresAt;
				}

				const mutation = await mutate(tx);
				if (
					key &&
					lockedClaimExpiry &&
					mutation.response.status === 429 &&
					mutation.effect === null
				) {
					// A rejected write can retry the same key once its rate limit clears.
					await releaseLockedClaim(tx, scope, key, lockedClaimExpiry);
					return mutation;
				}
				if (key && lockedClaimExpiry) {
					await completeClaimedResponse(tx, scope, key, mutation.response, lockedClaimExpiry);
				}
				return mutation;
			} catch (err) {
				callbackFailure = err;
				failedInCallback = true;
				throw err;
			}
		});
	} catch (err) {
		// Drizzle rethrows a callback error only after ROLLBACK succeeds.
		// A COMMIT failure leaves the claim in place for a safe later retry.
		if (key && lockedClaimExpiry && failedInCallback && err === callbackFailure) {
			await releaseClaimedResponse(scope, key, lockedClaimExpiry);
		}
		throw err;
	}
	return { ...result, key };
}

export async function persistAnnouncementReplayWarning(
	scope: string,
	key: string,
	entityId: string,
	warning: 'notification_delivery_failed' | 'notification_delivery_unknown',
): Promise<boolean> {
	const rows = await db
		.update(idempotencyResponses)
		.set({
			responseBody: sql`jsonb_set(${idempotencyResponses.responseBody}, '{body,warning}', to_jsonb(${warning}::text))`,
		})
		.where(
			and(
				eq(idempotencyResponses.scope, scope),
				eq(idempotencyResponses.key, key),
				gt(idempotencyResponses.expiresAt, new Date()),
				sql`${idempotencyResponses.responseBody}->>'entityId' = ${entityId}`,
				sql`${idempotencyResponses.responseBody}->>'status' = '200'`,
				sql`${idempotencyResponses.responseBody}->'body' ? 'warning'`,
				sql`(${idempotencyResponses.responseBody}->'body'->'warning' = 'null'::jsonb OR ${idempotencyResponses.responseBody}->'body'->>'warning' = ${warning})`,
			),
		)
		.returning({ scope: idempotencyResponses.scope });
	return rows.length === 1;
}
