import 'server-only';
import { and, inArray, lt } from 'drizzle-orm';
import { db, mailLog } from '@/core/db';

const MAIL_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
// Their dedupe keys only matter within a day; they hold an invitee address hash or an account id.
// `welcome` rows stay, because the row is what prevents a second welcome mail.
const PURGED_KINDS = ['invitation', 'reminder', 'account_deleted'] as const;
const PURGE_BATCH_SIZE = 5000;
const MAX_BATCHES_PER_RUN = 10;

/**
 * Deletes invitation, reminder and account-deleted ledger rows older than 90 days, in batches so
 * one run never holds a long delete. A backlog larger than the per-run cap is finished by the
 * following runs.
 */
export async function purgeOldMailLog(now = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - MAIL_LOG_RETENTION_MS);
	let total = 0;
	for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
		const deleted = await db
			.delete(mailLog)
			.where(
				inArray(
					mailLog.id,
					db
						.select({ id: mailLog.id })
						.from(mailLog)
						.where(and(inArray(mailLog.kind, PURGED_KINDS), lt(mailLog.createdAt, cutoff)))
						.limit(PURGE_BATCH_SIZE),
				),
			)
			.returning({ id: mailLog.id });
		total += deleted.length;
		if (deleted.length < PURGE_BATCH_SIZE) break;
	}
	return total;
}
