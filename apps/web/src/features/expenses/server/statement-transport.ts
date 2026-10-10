import 'server-only';
import { type MailTransport, createMailTransport } from '@/core/mail/transport';

export {
	type MailOutcome,
	type MailTransport,
	type OutgoingMail,
	maskEmail,
	readAllowlist,
} from '@/core/mail/transport';

/** The statement cron's transport; provider idempotency keys stay under `statements-`. */
export function createStatementTransport(
	env: Readonly<Record<string, string | undefined>> = process.env,
): MailTransport {
	return createMailTransport(env, 'statements');
}
