import 'server-only';
import { createHash } from 'node:crypto';

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const DEFAULT_FROM = 'ManaWG <noreply@manawg.com>';
const REQUEST_TIMEOUT_MS = 15_000;
// Resend allows two requests per second; single retries after a rejected batch pace themselves.
const SINGLE_SEND_GAP_MS = 550;

export interface OutgoingMail {
	/** Ledger row id and its attempt count; together they key the Idempotency-Key of the request. */
	ledgerId: string;
	attempt: number;
	to: string;
	subject: string;
	html: string;
	text: string;
	unsubscribeUrl: string;
}

export type MailOutcome =
	| { kind: 'sent'; providerId: string }
	/** `unconfirmed`: the request timed out, so the provider may have accepted it; never resend. */
	| { kind: 'failed'; error: string; unconfirmed?: boolean }
	/** Quota or rate limit reached: the mail was not attempted and stays queued. */
	| { kind: 'deferred' };

export interface MailTransport {
	readonly name: 'resend' | 'dry-run';
	/** One outcome per mail, in order. */
	sendBatch(mails: readonly OutgoingMail[]): Promise<MailOutcome[]>;
}

/** `l***@posteo.de`: enough to recognise a log line, never the full address. */
export function maskEmail(email: string): string {
	const at = email.lastIndexOf('@');
	if (at < 1) return '***';
	return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/** Comma-separated `STATEMENT_EMAIL_ALLOWLIST`, lower-cased; `null` when unset. */
export function readAllowlist(
	env: Readonly<Record<string, string | undefined>> = process.env,
): Set<string> | null {
	const entries = (env.STATEMENT_EMAIL_ALLOWLIST ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	return entries.length > 0 ? new Set(entries) : null;
}

function idempotencyKey(mails: readonly OutgoingMail[]): string {
	const ids = mails.map((mail) => `${mail.ledgerId}:${mail.attempt}`).sort();
	return `statements-${createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 48)}`;
}

function errorMessage(status: number, body: unknown): string {
	const message =
		body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
			? body.message
			: '';
	return `http_${status} ${message}`.trim().slice(0, 200);
}

function isQuotaError(status: number, body: unknown): boolean {
	if (status === 429) return true;
	const name = body && typeof body === 'object' && 'name' in body ? String(body.name) : '';
	return name.includes('quota_exceeded');
}

function createResendTransport(apiKey: string, from: string): MailTransport {
	async function post(mails: readonly OutgoingMail[]): Promise<MailOutcome[]> {
		const payload = mails.map((mail) => ({
			from,
			to: [mail.to],
			subject: mail.subject,
			html: mail.html,
			text: mail.text,
			headers: {
				'List-Unsubscribe': `<${mail.unsubscribeUrl}>`,
				'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
			},
		}));
		let response: Response;
		try {
			response = await fetch(RESEND_BATCH_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'Idempotency-Key': idempotencyKey(mails),
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			const timedOut = error instanceof Error && error.name === 'TimeoutError';
			return mails.map(() => ({
				kind: 'failed',
				error: timedOut ? 'timeout' : 'network_error',
				unconfirmed: timedOut,
			}));
		}
		const body: unknown = await response.json().catch(() => null);
		if (response.ok) {
			const data =
				body && typeof body === 'object' && 'data' in body && Array.isArray(body.data)
					? body.data
					: [];
			return mails.map((_, index) => {
				const id: unknown = data[index]?.id;
				return typeof id === 'string'
					? { kind: 'sent', providerId: id }
					: { kind: 'failed', error: 'missing_provider_id' };
			});
		}
		if (isQuotaError(response.status, body)) return mails.map(() => ({ kind: 'deferred' }));
		const failed: MailOutcome = { kind: 'failed', error: errorMessage(response.status, body) };
		// A rejected batch names no culprit; resend one by one so a single bad address cannot block the rest.
		if (mails.length > 1 && (response.status === 400 || response.status === 422)) {
			const outcomes: MailOutcome[] = [];
			for (const mail of mails) {
				await new Promise((resolve) => setTimeout(resolve, SINGLE_SEND_GAP_MS));
				const [outcome] = await post([mail]);
				outcomes.push(outcome ?? failed);
				if (outcome?.kind === 'deferred') {
					while (outcomes.length < mails.length) outcomes.push({ kind: 'deferred' });
					break;
				}
			}
			return outcomes;
		}
		return mails.map(() => failed);
	}
	return { name: 'resend', sendBatch: post };
}

/** Logs what would be sent; nothing leaves the process and the run writes no ledger rows. */
function createDryRunTransport(): MailTransport {
	return {
		name: 'dry-run',
		async sendBatch(mails) {
			return mails.map((mail) => {
				// biome-ignore lint/suspicious/noConsole: the dry-run transport exists to log.
				console.info(
					`[statement-mail] dry-run to=${maskEmail(mail.to)} subject="${mail.subject}" html=${mail.html.length}b`,
				);
				return { kind: 'sent', providerId: 'dry-run' } as const;
			});
		},
	};
}

/**
 * Resend in production (a missing key throws instead of degrading to a dry
 * run); elsewhere only when an allow-list limits the recipients and a key is
 * set (Preview testing). Otherwise the dry-run transport.
 */
export function createStatementTransport(
	env: Readonly<Record<string, string | undefined>> = process.env,
): MailTransport {
	const apiKey = env.RESEND_API_KEY?.trim();
	const mayReallySend = env.VERCEL_ENV === 'production' || readAllowlist(env) !== null;
	if (env.VERCEL_ENV === 'production' && !apiKey) {
		throw new Error('RESEND_API_KEY is not set in production');
	}
	if (!mayReallySend || !apiKey) return createDryRunTransport();
	return createResendTransport(apiKey, env.STATEMENT_EMAIL_FROM?.trim() || DEFAULT_FROM);
}
