import 'server-only';
import { loadConfirmedEmails } from '@/core/auth/auth-user-emails';
import { logApiError } from '@/core/infra/observability';
import { sendMailSafely } from './send-mail';
import { renderAccountDeletedMail } from './templates';

/** The farewell mail (E10) needs the address before Auth forgets it; a failed lookup only skips the mail. */
export async function confirmedEmailOf(authUserId: string): Promise<string | null> {
	try {
		return (await loadConfirmedEmails([authUserId])).emails.get(authUserId) ?? null;
	} catch (err) {
		logApiError('[mail] e-mail lookup failed', err);
		return null;
	}
}

export async function sendAccountDeletedMail(
	authUserId: string,
	email: string | null,
): Promise<void> {
	if (!email) return;
	await sendMailSafely({
		kind: 'account_deleted',
		dedupeKey: `account-deleted:${authUserId}`,
		to: email,
		mail: renderAccountDeletedMail(),
	});
}
