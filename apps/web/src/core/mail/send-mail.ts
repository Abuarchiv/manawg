import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db, mailLog } from '@/core/db';
import { logApiError } from '@/core/infra/observability';
import type { RenderedMail } from './brand-mail';
import { createMailTransport, type MailTransport, maskEmail } from './transport';

type MailKind = 'welcome' | 'invitation' | 'reminder' | 'account_deleted';

export interface SendMailInput {
	kind: MailKind;
	/** Unique per mail that may go out once; a second call with the same key is a no-op. */
	dedupeKey: string;
	to: string;
	mail: RenderedMail;
	wgId?: string;
	memberId?: string;
	/** Present for optional mails (reminder); drives the List-Unsubscribe header. */
	unsubscribeUrl?: string;
}

/** `unconfirmed`: the provider timed out, so the mail may have arrived; it is never retried. */
export type SendMailResult = 'sent' | 'duplicate' | 'failed' | 'deferred' | 'unconfirmed';

/**
 * Sends one transactional mail at most once. The ledger row is claimed first
 * (`sending`), then the provider is called, then the outcome is written. A
 * `failed` row can be claimed again, and so can a `sending` row older than 15 minutes (a crashed
 * run); `sent` and recent in-flight rows are not.
 */
export async function sendMail(
	input: SendMailInput,
	transport: MailTransport = createMailTransport(process.env, 'mail'),
): Promise<SendMailResult> {
	const [claimed] = await db
		.insert(mailLog)
		.values({
			kind: input.kind,
			dedupeKey: input.dedupeKey,
			wgId: input.wgId ?? null,
			memberId: input.memberId ?? null,
			status: 'sending',
		})
		.onConflictDoUpdate({
			target: mailLog.dedupeKey,
			// A `sending` row with no recorded outcome (the process died mid-request) is taken
			// over after 15 minutes. Its attempt count stays, so the provider's
			// Idempotency-Key is the same and a mail that did go out is not delivered twice;
			// `created_at` restarts the window for the new owner.
			set: {
				status: 'sending',
				attempts: sql`${mailLog.attempts} + case when ${mailLog.status} = 'failed' then 1 else 0 end`,
				error: null,
				createdAt: sql`now()`,
			},
			setWhere: sql`${mailLog.status} = 'failed' or (${mailLog.status} = 'sending' and ${mailLog.createdAt} < now() - interval '15 minutes')`,
		})
		.returning({ id: mailLog.id, attempts: mailLog.attempts });
	if (!claimed) return 'duplicate';

	const [outcome] = await transport.sendBatch([
		{
			ledgerId: claimed.id,
			attempt: claimed.attempts,
			to: input.to,
			subject: input.mail.subject,
			html: input.mail.html,
			text: input.mail.text,
			...(input.unsubscribeUrl ? { unsubscribeUrl: input.unsubscribeUrl } : {}),
		},
	]);
	if (outcome?.kind === 'sent') {
		await db
			.update(mailLog)
			.set({ status: 'sent', providerId: outcome.providerId, sentAt: new Date() })
			.where(eq(mailLog.id, claimed.id));
		return 'sent';
	}
	// Deferred (quota) and failed rows stay claimable for a later attempt. A timed-out
	// request may still have been delivered; such rows are marked and never retried.
	const unconfirmed = outcome?.kind === 'failed' && outcome.unconfirmed === true;
	await db
		.update(mailLog)
		.set({
			status: unconfirmed ? 'sent' : 'failed',
			error:
				outcome?.kind === 'failed'
					? unconfirmed
						? 'unconfirmed_timeout'
						: outcome.error
					: outcome?.kind === 'deferred'
						? 'provider_deferred'
						: 'no_outcome',
		})
		.where(eq(mailLog.id, claimed.id));
	if (unconfirmed) return 'unconfirmed';
	return outcome?.kind === 'deferred' ? 'deferred' : 'failed';
}

/** Fire-and-forget variant for request handlers: logs instead of throwing. */
export async function sendMailSafely(input: SendMailInput): Promise<SendMailResult | 'error'> {
	try {
		return await sendMail(input);
	} catch (err) {
		logApiError(`[mail] ${input.kind} to ${maskEmail(input.to)} failed`, err);
		return 'error';
	}
}
