import 'server-only';
import { renderStatementMail } from '../statement-mail';
import type { StatementRecipient } from '../statement-recipients';
import {
	CLAIM_BATCH_SIZE,
	type ClaimedRow,
	type RowUpdate,
	claimBatch,
	closeInterruptedRows,
	queueRows,
	recordOutcomes,
} from './statement-ledger';
import { type WgStatementPlan, loadStatementPlans } from './statement-plans';
import { type MailTransport, type OutgoingMail, readAllowlist } from './statement-transport';
import { unsubscribeUrl } from './statement-unsubscribe';

export interface StatementRunSummary {
	monthKey: string;
	transport: MailTransport['name'];
	queued: number;
	skipped: number;
	sent: number;
	failed: number;
	/** Rows whose mail may have gone out without a recorded result; they are never resent. */
	unconfirmed: number;
	/** The provider refused further mails (quota/rate limit); the rest waits for the next run. */
	quotaReached: boolean;
}

interface DispatchResult {
	updates: RowUpdate[];
	/** Rows handed back as pending because the provider deferred them. */
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
			updates.push({ id: mail.ledgerId, status: 'pending' });
		} else {
			updates.push({
				id: mail.ledgerId,
				status: 'failed',
				error: outcome?.kind === 'failed' ? outcome.error : 'no_outcome',
				unconfirmed: outcome?.kind === 'failed' && outcome.unconfirmed === true,
			});
		}
	});
	return { updates, deferred };
}

type RecipientMap = Map<string, { wg: WgStatementPlan['wg']; recipient: StatementRecipient }>;

function logUnfinished(summary: StatementRunSummary, interrupted: number): void {
	if (
		summary.failed === 0 &&
		summary.unconfirmed === 0 &&
		!summary.quotaReached &&
		interrupted === 0
	)
		return;
	console.warn(
		`[statement-mail] month=${summary.monthKey} failed=${summary.failed} unconfirmed=${summary.unconfirmed} interrupted=${interrupted} quotaReached=${summary.quotaReached}`,
	);
}

/** Dry run: renders and logs every mail, touches no ledger row. */
async function logDryRun(recipients: RecipientMap, transport: MailTransport): Promise<void> {
	const rows = [...recipients.keys()].map((memberId) => ({ id: memberId, memberId, attempts: 1 }));
	for (let start = 0; start < rows.length; start += CLAIM_BATCH_SIZE) {
		await dispatchStatementBatch(
			rows.slice(start, start + CLAIM_BATCH_SIZE),
			recipients,
			transport,
		);
	}
}

/**
 * One run for a month's plans: queue ledger rows (existing ones stay untouched),
 * then claim open rows in batches. A claim is committed as `sending` before the
 * mail goes out and the result is written afterwards in a short transaction, so
 * a repeated or parallel run skips rows in flight and a crash leaves them
 * `sending` (closed as unconfirmed later, never resent). The dry-run transport
 * never writes the ledger.
 */
export async function runStatementPlans(
	plans: readonly WgStatementPlan[],
	monthKey: string,
	transport: MailTransport,
): Promise<StatementRunSummary> {
	const allowlist = readAllowlist();
	const recipients: RecipientMap = new Map();
	for (const { wg, plan } of plans) {
		for (const recipient of plan.recipients) {
			if (allowlist && !allowlist.has(recipient.email.toLowerCase())) continue;
			recipients.set(recipient.memberId, { wg, recipient });
		}
	}
	const summary: StatementRunSummary = {
		monthKey,
		transport: transport.name,
		queued: 0,
		skipped: 0,
		sent: 0,
		failed: 0,
		unconfirmed: 0,
		quotaReached: false,
	};
	if (transport.name === 'dry-run') {
		await logDryRun(recipients, transport);
		summary.queued = recipients.size;
		return summary;
	}

	const interrupted = await closeInterruptedRows();
	summary.unconfirmed = interrupted;
	const { queued, skipped } = await queueRows(plans, monthKey, allowlist);
	summary.queued = queued;
	summary.skipped = skipped;
	// Rows the allow-list holds back must not be claimed at all.
	const claimable = allowlist ? [...recipients.keys()] : null;
	if (claimable?.length === 0) return summary;

	const attempted = new Set<string>();
	for (;;) {
		const rows = await claimBatch(monthKey, claimable, attempted);
		if (rows.length === 0) break;
		for (const row of rows) attempted.add(row.id);

		let result: DispatchResult;
		try {
			result = await dispatchStatementBatch(rows, recipients, transport);
		} catch (error) {
			const failed = rows.map((row) => ({
				id: row.id,
				status: 'failed' as const,
				error: 'dispatch_error',
			}));
			await recordOutcomes(failed, rows).catch(() => undefined);
			throw error;
		}
		await recordOutcomes(result.updates, rows);
		for (const update of result.updates) {
			if (update.status === 'sent') summary.sent += 1;
			if (update.status === 'failed') summary.failed += 1;
			if (update.unconfirmed) summary.unconfirmed += 1;
		}
		if (result.deferred > 0) {
			summary.quotaReached = true;
			break;
		}
	}
	logUnfinished(summary, interrupted);
	return summary;
}

/** One cron run for a month: loads the plans and runs them. */
export async function runMonthlyStatements(
	monthKey: string,
	transport: MailTransport,
): Promise<StatementRunSummary> {
	return runStatementPlans(await loadStatementPlans(monthKey), monthKey, transport);
}
