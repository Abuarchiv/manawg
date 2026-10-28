import 'server-only';
import { createMailTransport, type MailTransport } from '@/core/mail/transport';

export {
	type MailOutcome,
	type MailTransport,
	maskEmail,
	type OutgoingMail,
	readAllowlist,
} from '@/core/mail/transport';

/** The statement cron's transport; provider idempotency keys stay under `statements-`. */
export function createStatementTransport(
	env: Readonly<Record<string, string | undefined>> = process.env,
): MailTransport {
	return createMailTransport(env, 'statements');
}
