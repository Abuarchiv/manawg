import 'server-only';
import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { isOfficialInstance } from '@/shared/lib/landing-url';

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
// The batch endpoint cannot carry attachments, so those mails go one request each.
const RESEND_SINGLE_URL = 'https://api.resend.com/emails';
const OFFICIAL_FROM = 'ManaWG <noreply@manawg.com>';
const REQUEST_TIMEOUT_MS = 15_000;
// Resend allows two requests per second; single retries after a rejected batch pace themselves.
const SINGLE_SEND_GAP_MS = 550;
// The cron function is killed at 60 s; the budget leaves room for the last request's timeout.
const SINGLE_RESEND_BUDGET_MS = 40_000;

export interface OutgoingMail {
	/** Ledger row id and its attempt count; together they key the Idempotency-Key of the request. */
	ledgerId: string;
	attempt: number;
	to: string;
	subject: string;
	html: string;
	text: string;
	/** Absent for transactional mails (account, invitation) that must always arrive. */
	unsubscribeUrl?: string;
	attachments?: Array<{ filename: string; content: Uint8Array; contentType: string }>;
}

export type MailOutcome =
	| { kind: 'sent'; providerId: string }
	/** `unconfirmed`: the request timed out, so the provider may have accepted it; never resend. */
	| { kind: 'failed'; error: string; unconfirmed?: boolean }
	/** Quota or rate limit reached: the mail was not attempted and stays queued. */
	| { kind: 'deferred' };

export interface MailTransport {
	readonly name: 'resend' | 'smtp' | 'dry-run';
	/**
	 * One outcome per mail, in order. Mails with attachments are sent one by one; no new request
	 * starts after `deadline` (epoch ms), the rest is deferred.
	 */
	sendBatch(mails: readonly OutgoingMail[], deadline?: number): Promise<MailOutcome[]>;
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

function idempotencyKey(prefix: string, mails: readonly OutgoingMail[]): string {
	const ids = mails.map((mail) => `${mail.ledgerId}:${mail.attempt}`).sort();
	return `${prefix}-${createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 48)}`;
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

function unsubscribeHeaders(mail: OutgoingMail): { headers?: Record<string, string> } {
	return mail.unsubscribeUrl
		? {
				headers: {
					'List-Unsubscribe': `<${mail.unsubscribeUrl}>`,
					'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
				},
			}
		: {};
}

type ResendReply =
	| { response: Response; body: unknown }
	| { failure: Extract<MailOutcome, { kind: 'failed' }> };

function createResendTransport(apiKey: string, from: string, prefix: string): MailTransport {
	async function request(
		url: string,
		payload: unknown,
		mails: readonly OutgoingMail[],
	): Promise<ResendReply> {
		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'Idempotency-Key': idempotencyKey(prefix, mails),
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			return { response, body: await response.json().catch(() => null) };
		} catch (error) {
			const timedOut = error instanceof Error && error.name === 'TimeoutError';
			return {
				failure: {
					kind: 'failed',
					error: timedOut ? 'timeout' : 'network_error',
					unconfirmed: timedOut,
				},
			};
		}
	}

	const content = (mail: OutgoingMail) => ({
		from,
		to: [mail.to],
		subject: mail.subject,
		html: mail.html,
		text: mail.text,
		...unsubscribeHeaders(mail),
	});

	/** One mail with attachments to the single-send endpoint. */
	async function postSingle(mail: OutgoingMail): Promise<MailOutcome> {
		const payload = {
			...content(mail),
			attachments: mail.attachments?.map((file) => ({
				filename: file.filename,
				content: Buffer.from(file.content).toString('base64'),
				content_type: file.contentType,
			})),
		};
		const reply = await request(RESEND_SINGLE_URL, payload, [mail]);
		if ('failure' in reply) return reply.failure;
		const { response, body } = reply;
		const id: unknown = body && typeof body === 'object' && 'id' in body ? body.id : undefined;
		if (response.ok) {
			return typeof id === 'string'
				? { kind: 'sent', providerId: id }
				: { kind: 'failed', error: 'missing_provider_id' };
		}
		if (isQuotaError(response.status, body)) return { kind: 'deferred' };
		return { kind: 'failed', error: errorMessage(response.status, body) };
	}

	async function post(mails: readonly OutgoingMail[]): Promise<MailOutcome[]> {
		const reply = await request(RESEND_BATCH_URL, mails.map(content), mails);
		if ('failure' in reply) return mails.map(() => reply.failure);
		const { response, body } = reply;
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
			const deadline = Date.now() + SINGLE_RESEND_BUDGET_MS;
			for (const mail of mails) {
				// Mails past the budget stay queued instead of being lost when the function is killed.
				if (Date.now() > deadline) {
					while (outcomes.length < mails.length) outcomes.push({ kind: 'deferred' });
					break;
				}
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

	/** Mails without attachments share one batch request; the others follow one by one, paced. */
	async function sendBatch(mails: readonly OutgoingMail[], runDeadline = Infinity) {
		const outcomes: MailOutcome[] = mails.map(() => ({ kind: 'deferred' }));
		const plain = mails.filter((mail) => !mail.attachments?.length);
		const plainOutcomes = plain.length > 0 ? await post(plain) : [];
		plain.forEach((mail, index) => {
			outcomes[mails.indexOf(mail)] = plainOutcomes[index] ?? { kind: 'deferred' };
		});
		// A refused batch means the quota is used up; the attachment mails wait for the next run.
		if (plainOutcomes.some((outcome) => outcome.kind === 'deferred')) return outcomes;
		const deadline = Math.min(runDeadline, Date.now() + SINGLE_RESEND_BUDGET_MS);
		let paced = plain.length > 0;
		for (const [index, mail] of mails.entries()) {
			if (!mail.attachments?.length) continue;
			// Mails past the budget stay deferred instead of being lost when the function is killed.
			if (Date.now() > deadline) break;
			if (paced) await new Promise((resolve) => setTimeout(resolve, SINGLE_SEND_GAP_MS));
			paced = true;
			const outcome = await postSingle(mail);
			outcomes[index] = outcome;
			if (outcome.kind === 'deferred') break;
		}
		return outcomes;
	}
	return { name: 'resend', sendBatch };
}

/** A mail catcher on the Docker network or this machine, which speaks no TLS. */
const LOCAL_SMTP_HOST = /^(?:localhost|127\.0\.0\.1|::1|[a-z0-9][a-z0-9_-]*)$/i;

/**
 * Port 465 is implicit TLS; any other port must upgrade with STARTTLS, so a relay on the internet
 * cannot be downgraded to plain text. Hosts without a dot (Mailpit) are exempt.
 */
export function smtpOptions(env: Readonly<Record<string, string | undefined>>) {
	const host = env.SMTP_HOST?.trim() ?? '';
	const port = Number(env.SMTP_PORT?.trim() || 587);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('SMTP_PORT must be a port number.');
	}
	const user = env.SMTP_USER?.trim();
	return {
		host,
		port,
		secure: port === 465,
		requireTLS: port !== 465 && !LOCAL_SMTP_HOST.test(host),
		auth: user ? { user, pass: env.SMTP_PASS ?? '' } : undefined,
		connectionTimeout: REQUEST_TIMEOUT_MS,
		socketTimeout: REQUEST_TIMEOUT_MS,
	};
}

/** Plain SMTP for self-hosted instances; mails go out one by one, failures stay per mail. */
function createSmtpTransport(
	env: Readonly<Record<string, string | undefined>>,
	from: string,
): MailTransport {
	const transporter = nodemailer.createTransport(smtpOptions(env));
	return {
		name: 'smtp',
		async sendBatch(mails) {
			const outcomes: MailOutcome[] = [];
			for (const mail of mails) {
				try {
					const info = await transporter.sendMail({
						from,
						to: mail.to,
						subject: mail.subject,
						html: mail.html,
						text: mail.text,
						...unsubscribeHeaders(mail),
						...(mail.attachments?.length
							? {
									attachments: mail.attachments.map((file) => ({
										filename: file.filename,
										content: Buffer.from(file.content),
										contentType: file.contentType,
									})),
								}
							: {}),
					});
					outcomes.push({ kind: 'sent', providerId: info.messageId });
				} catch (error) {
					const code = error instanceof Error && 'code' in error ? String(error.code) : 'error';
					// An idle socket may time out after the relay took the message, so a socket timeout is
					// never resent; connect, greeting and upgrade timeouts happen before and stay retryable.
					const unconfirmed =
						error instanceof Error &&
						'timeoutType' in error &&
						error.timeoutType === 'SOCKET_TIMEOUT';
					outcomes.push({
						kind: 'failed',
						error: `smtp_${code}`.slice(0, 200),
						...(unconfirmed ? { unconfirmed: true } : {}),
					});
				}
			}
			return outcomes;
		},
	};
}

/** Logs what would be sent; nothing leaves the process and the run writes no ledger rows. */
function createDryRunTransport(): MailTransport {
	return {
		name: 'dry-run',
		async sendBatch(mails) {
			return mails.map((mail) => {
				// biome-ignore lint/suspicious/noConsole: the dry-run transport exists to log.
				console.info(
					`[mail] dry-run to=${maskEmail(mail.to)} subject="${mail.subject}" html=${mail.html.length}b attachments=${mail.attachments?.length ?? 0} ${mail.attachments?.reduce((sum, file) => sum + file.content.byteLength, 0) ?? 0}b`,
				);
				return { kind: 'sent', providerId: 'dry-run' } as const;
			});
		},
	};
}

/** The configured sender; only the official instance may fall back to its own address. */
function senderAddress(env: Readonly<Record<string, string | undefined>>): string {
	const from =
		env.STATEMENT_EMAIL_FROM?.trim() ||
		(isOfficialInstance(env.NEXT_PUBLIC_APP_URL) ? OFFICIAL_FROM : '');
	if (!from) throw new Error('STATEMENT_EMAIL_FROM is not set');
	return from;
}

/**
 * SMTP whenever `SMTP_HOST` is set (self-hosted instances). Otherwise Resend in production (a
 * missing key throws instead of degrading to a dry run); elsewhere only when an allow-list limits
 * the recipients and a key is set (Preview testing). Otherwise the dry-run transport. `prefix`
 * namespaces the provider idempotency keys per sender (statements, transactional mails).
 */
export function createMailTransport(
	env: Readonly<Record<string, string | undefined>> = process.env,
	prefix = 'mail',
): MailTransport {
	if (env.SMTP_HOST?.trim()) return createSmtpTransport(env, senderAddress(env));
	const apiKey = env.RESEND_API_KEY?.trim();
	const mayReallySend = env.VERCEL_ENV === 'production' || readAllowlist(env) !== null;
	if (env.VERCEL_ENV === 'production' && !apiKey) {
		throw new Error('RESEND_API_KEY is not set in production');
	}
	if (!mayReallySend || !apiKey) return createDryRunTransport();
	return createResendTransport(apiKey, senderAddress(env), prefix);
}
