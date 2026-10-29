import 'server-only';
import { loadConfirmedEmails } from '@/core/auth/auth-user-emails';
import { logApiError } from '@/core/infra/observability';
import type { Locale } from '@/shared/i18n/locale';
import { sendMailSafely } from './send-mail';
import { renderAccountDeletedMail } from './templates';

export interface FarewellRecipient {
	email: string;
	/** The language stored on the account, `null` when it never chose one. */
	locale: Locale | null;
}

/** The farewell mail (E10) needs the address before Auth forgets it; a failed lookup only skips the mail. */
export async function confirmedRecipientOf(authUserId: string): Promise<FarewellRecipient | null> {
	try {
		const { emails, locales } = await loadConfirmedEmails([authUserId]);
		const email = emails.get(authUserId);
		return email ? { email, locale: locales.get(authUserId) ?? null } : null;
	} catch (err) {
		logApiError('[mail] e-mail lookup failed', err);
		return null;
	}
}

export async function sendAccountDeletedMail(
	authUserId: string,
	email: string | null,
	locale: Locale,
): Promise<void> {
	if (!email) return;
	await sendMailSafely({
		kind: 'account_deleted',
		dedupeKey: `account-deleted:${authUserId}`,
		to: email,
		mail: renderAccountDeletedMail(locale),
	});
}
