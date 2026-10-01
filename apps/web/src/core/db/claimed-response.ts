import { idempotencyResponses } from '@/core/db';
import type { DbTransaction } from '@/core/db/transaction';
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
