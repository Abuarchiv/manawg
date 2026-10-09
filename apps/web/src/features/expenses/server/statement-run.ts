import 'server-only';
import { db, statementEmails, withTransaction } from '@/core/db';
import { and, asc, eq, inArray, lt, notInArray } from 'drizzle-orm';
import { renderStatementMail } from '../statement-mail';
import type { StatementRecipient } from '../statement-recipients';
import { type WgStatementPlan, loadStatementPlans } from './statement-plans';
import { type MailTransport, type OutgoingMail, readAllowlist } from './statement-transport';
import { unsubscribeUrl } from './statement-unsubscribe';

export const CLAIM_BATCH_SIZE = 100;
/** Failed rows are retried until they reach this many attempts (one per cron day 1-5). */
export const MAX_ATTEMPTS = 5;
const INSERT_CHUNK = 500;

export interface StatementRunSummary {
	monthKey: string;
	transport: MailTransport['name'];
	queued: number;
	skipped: number;
	sent: number;
	failed: number;
	/** The provider refused further mails (quota/rate limit); the rest waits for the next run. */
	quotaReached: boolean;
}

interface ClaimedRow {
	id: string;
	memberId: string;
	attempts: number;
}

interface RowUpdate {
	id: string;
	status: 'sent' | 'failed' | 'skipped';
	skipReason?: string;
	providerId?: string;
	error?: string;
}

interface DispatchResult {
	updates: RowUpdate[];
	/** Rows left untouched because the provider deferred them. */
	deferred: number;
}

/**
 * Sends one claimed batch and decides every row's new state. A claimed row
 * whose member is not a recipient at send time (opted out, left, address gone
 * after the row was queued) ends as skipped instead of being mailed.
 */
export async function dispatchStatementBatch(
	rows: readonly ClaimedRow[],
	recipients: ReadonlyMap<string, { wg: WgStatementPlan['wg']; recipient: StatementRecipient }>,
	transport: MailTransport,
): Promise<DispatchResult> {
	const updates: RowUpdate[] = [];
	const mails: OutgoingMail[] = [];
	for (const row of rows) {
		const entry = recipients.get(row.memberId);
		if (!entry) {
			updates.push({ id: row.id, status: 'skipped', skipReason: 'not_eligible_at_send' });
			continue;
		}
		const url = unsubscribeUrl(row.memberId);
		const mail = renderStatementMail({
			wgName: entry.wg.name,
			shareCode: entry.wg.shareCode,
			statement: entry.recipient.statement,
			memberId: row.memberId,
			unsubscribeUrl: url,
		});
		mails.push({
			ledgerId: row.id,
			attempt: row.attempts,
			to: entry.recipient.email,
			subject: mail.subject,
			html: mail.html,
			text: mail.text,
			unsubscribeUrl: url,
		});
	}
	const outcomes = mails.length > 0 ? await transport.sendBatch(mails) : [];
	let deferred = 0;
	mails.forEach((mail, index) => {
		const outcome = outcomes[index];
		if (outcome?.kind === 'sent') {
			updates.push({ id: mail.ledgerId, status: 'sent', providerId: outcome.providerId });
		} else if (outcome?.kind === 'deferred') {
			deferred += 1;
		} else {
			updates.push({
				id: mail.ledgerId,
				status: 'failed',
				error: outcome?.kind === 'failed' ? outcome.error : 'no_outcome',
			});
		}
	});
	return { updates, deferred };
}

/** Inserts the month's ledger rows; rows that already exist stay untouched and are not counted. */
async function queueRows(
	plans: readonly WgStatementPlan[],
	monthKey: string,
	allowlist: Set<string> | null,
) {
	const values: Array<typeof statementEmails.$inferInsert> = [];
	for (const { wg, plan } of plans) {
		for (const recipient of plan.recipients) {
			if (allowlist && !allowlist.has(recipient.email.toLowerCase())) continue;
			values.push({ wgId: wg.id, memberId: recipient.memberId, monthKey, status: 'pending' });
		}
		for (const skip of plan.skipped) {
			values.push({
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
	for (let start = 0; start < values.length; start += INSERT_CHUNK) {
		const inserted = await db
			.insert(statementEmails)
			.values(values.slice(start, start + INSERT_CHUNK))
			.onConflictDoNothing()
			.returning({ status: statementEmails.status });
		for (const row of inserted) {
			if (row.status === 'pending') queued += 1;
			else skipped += 1;
		}
	}
	return { queued, skipped };
}

/**
 * One cron run for a month: queue ledger rows (existing ones stay untouched),
 * then claim open rows in batches with `FOR UPDATE SKIP LOCKED` and send them.
 * The claim transaction stays open while sending, so a parallel or repeated
 * run skips these rows and a crash rolls them back to pending.
 */
export async function runMonthlyStatements(
	monthKey: string,
	transport: MailTransport,
): Promise<StatementRunSummary> {
	const plans = await loadStatementPlans(monthKey);
	const allowlist = readAllowlist();
	const { queued, skipped } = await queueRows(plans, monthKey, allowlist);

	const recipients = new Map<
		string,
		{ wg: WgStatementPlan['wg']; recipient: StatementRecipient }
	>();
	for (const { wg, plan } of plans) {
		for (const recipient of plan.recipients) {
			if (allowlist && !allowlist.has(recipient.email.toLowerCase())) continue;
			recipients.set(recipient.memberId, { wg, recipient });
		}
	}

	const summary: StatementRunSummary = {
		monthKey,
		transport: transport.name,
		queued,
		skipped,
		sent: 0,
		failed: 0,
		quotaReached: false,
	};
	// Rows the allow-list holds back must not be claimed at all.
	const claimable = allowlist ? [...recipients.keys()] : null;
	if (claimable?.length === 0) return summary;

	const attempted = new Set<string>();
	for (;;) {
		const stop = await withTransaction(async (tx) => {
			const filters = [
				eq(statementEmails.monthKey, monthKey),
				inArray(statementEmails.status, ['pending', 'failed']),
				lt(statementEmails.attempts, MAX_ATTEMPTS),
			];
			if (claimable) filters.push(inArray(statementEmails.memberId, claimable));
			// Rows already handled in this run (failed ones are still open) are not claimed twice.
			if (attempted.size > 0) filters.push(notInArray(statementEmails.id, [...attempted]));
			const rows = await tx
				.select({
					id: statementEmails.id,
					memberId: statementEmails.memberId,
					attempts: statementEmails.attempts,
				})
				.from(statementEmails)
				.where(and(...filters))
				.orderBy(asc(statementEmails.createdAt))
				.limit(CLAIM_BATCH_SIZE)
				.for('update', { skipLocked: true });
			if (rows.length === 0) return true;
			for (const row of rows) attempted.add(row.id);

			const { updates, deferred } = await dispatchStatementBatch(rows, recipients, transport);
			const attemptsById = new Map(rows.map((row) => [row.id, row.attempts]));
			for (const update of updates) {
				await tx
					.update(statementEmails)
					.set({
						status: update.status,
						skipReason: update.skipReason ?? null,
						providerId: update.providerId ?? null,
						error: update.error ?? null,
						attempts: (attemptsById.get(update.id) ?? 0) + (update.status === 'skipped' ? 0 : 1),
						sentAt: update.status === 'sent' ? new Date() : null,
					})
					.where(eq(statementEmails.id, update.id));
				if (update.status === 'sent') summary.sent += 1;
				if (update.status === 'failed') summary.failed += 1;
			}
			if (deferred > 0) summary.quotaReached = true;
			return deferred > 0;
		});
		if (stop) break;
	}
	return summary;
}
