import 'server-only';
import { and, asc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { db, statementEmails, withTransaction } from '@/core/db';
import type { WgStatementPlan } from './statement-plans';

export const CLAIM_BATCH_SIZE = 100;
/** Failed rows are retried until they reach this many attempts (one per cron day 1-5). */
const MAX_ATTEMPTS = 5;
const INSERT_CHUNK = 500;
/** A `sending` row older than this never got its result written down. */
const LEASE_MS = 15 * 60 * 1000;

/** A row claimed for sending; `attempts` already counts this claim. */
export interface ClaimedRow {
	id: string;
	memberId: string;
	attempts: number;
}

export interface RowUpdate {
	id: string;
	/** `pending` hands a row back untouched (provider deferred it). */
	status: 'sent' | 'failed' | 'skipped' | 'pending';
	skipReason?: string;
	providerId?: string;
	error?: string;
	/** The provider may have accepted the mail: never retried automatically. */
	unconfirmed?: boolean;
}

/**
 * Inserts the month's ledger rows. Existing rows stay untouched, except that a
 * `skipped` row whose member is a recipient now is queued again (confirmed
 * address, preference switched back on, expense booked on a later day).
 */
export async function queueRows(
	plans: readonly WgStatementPlan[],
	monthKey: string,
	allowlist: Set<string> | null,
) {
	const open: Array<typeof statementEmails.$inferInsert> = [];
	const skips: Array<typeof statementEmails.$inferInsert> = [];
	for (const { wg, plan } of plans) {
		for (const recipient of plan.recipients) {
			if (allowlist && !allowlist.has(recipient.email.toLowerCase())) continue;
			open.push({ wgId: wg.id, memberId: recipient.memberId, monthKey, status: 'pending' });
		}
		for (const skip of plan.skipped) {
			skips.push({
				wgId: wg.id,
				memberId: skip.memberId,
				monthKey,
				status: 'skipped',
				skipReason: skip.reason,
			});
		}
	}
	let queued = 0;
	let skipped = 0;
	const count = (rows: Array<{ status: string }>) => {
		for (const row of rows) {
			if (row.status === 'pending') queued += 1;
			else skipped += 1;
		}
	};
	for (let start = 0; start < open.length; start += INSERT_CHUNK) {
		count(
			await db
				.insert(statementEmails)
				.values(open.slice(start, start + INSERT_CHUNK))
				.onConflictDoUpdate({
					target: [statementEmails.memberId, statementEmails.monthKey],
					set: { status: 'pending', skipReason: null },
					setWhere: eq(statementEmails.status, 'skipped'),
				})
				.returning({ status: statementEmails.status }),
		);
	}
	for (let start = 0; start < skips.length; start += INSERT_CHUNK) {
		count(
			await db
				.insert(statementEmails)
				.values(skips.slice(start, start + INSERT_CHUNK))
				.onConflictDoNothing()
				.returning({ status: statementEmails.status }),
		);
	}
	return { queued, skipped };
}

/**
 * Rows left `sending` by a run that died before writing its result: the mail
 * may or may not have gone out, so they are closed as unconfirmed, not resent.
 */
export async function closeInterruptedRows(): Promise<number> {
	const rows = await db
		.update(statementEmails)
		.set({ status: 'failed', error: 'interrupted_unconfirmed', attempts: MAX_ATTEMPTS })
		.where(
			and(
				eq(statementEmails.status, 'sending'),
				lt(statementEmails.claimedAt, new Date(Date.now() - LEASE_MS)),
			),
		)
		.returning({ id: statementEmails.id });
	return rows.length;
}

/**
 * Claims open rows with `FOR UPDATE SKIP LOCKED` and commits them as `sending`
 * before anything is sent, so no transaction stays open across the provider call.
 */
export async function claimBatch(
	monthKey: string,
	claimable: readonly string[] | null,
	attempted: ReadonlySet<string>,
): Promise<ClaimedRow[]> {
	return withTransaction(async (tx) => {
		const filters = [
			eq(statementEmails.monthKey, monthKey),
			inArray(statementEmails.status, ['pending', 'failed']),
			lt(statementEmails.attempts, MAX_ATTEMPTS),
		];
		if (claimable) filters.push(inArray(statementEmails.memberId, [...claimable]));
		// Rows already handled in this run (failed ones are still open) are not claimed twice.
		if (attempted.size > 0) filters.push(notInArray(statementEmails.id, [...attempted]));
		const rows = await tx
			.select({ id: statementEmails.id })
			.from(statementEmails)
			.where(and(...filters))
			.orderBy(asc(statementEmails.createdAt))
			.limit(CLAIM_BATCH_SIZE)
			.for('update', { skipLocked: true });
		if (rows.length === 0) return [];
		return tx
			.update(statementEmails)
			.set({
				status: 'sending',
				attempts: sql`${statementEmails.attempts} + 1`,
				claimedAt: new Date(),
			})
			.where(
				inArray(
					statementEmails.id,
					rows.map((row) => row.id),
				),
			)
			.returning({
				id: statementEmails.id,
				memberId: statementEmails.memberId,
				attempts: statementEmails.attempts,
			});
	});
}

async function writeOutcomes(updates: readonly RowUpdate[], claimed: ReadonlyMap<string, number>) {
	await withTransaction(async (tx) => {
		for (const update of updates) {
			const counted = claimed.get(update.id) ?? 1;
			const handedBack = update.status === 'skipped' || update.status === 'pending';
			await tx
				.update(statementEmails)
				.set({
					status: update.status,
					skipReason: update.skipReason ?? null,
					providerId: update.providerId ?? null,
					error: update.error ?? null,
					attempts: update.unconfirmed ? MAX_ATTEMPTS : handedBack ? counted - 1 : counted,
					sentAt: update.status === 'sent' ? new Date() : null,
				})
				.where(eq(statementEmails.id, update.id));
		}
	});
}

/** Writes a batch's result in one short transaction, tried twice before giving up. */
export async function recordOutcomes(
	updates: readonly RowUpdate[],
	rows: readonly ClaimedRow[],
): Promise<void> {
	const claimed = new Map(rows.map((row) => [row.id, row.attempts]));
	try {
		await writeOutcomes(updates, claimed);
	} catch (error) {
		console.warn('[statement-mail] outcome write failed, retrying', error);
		await writeOutcomes(updates, claimed);
	}
}
