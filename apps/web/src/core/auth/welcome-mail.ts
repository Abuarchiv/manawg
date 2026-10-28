import { afterResponse } from '@/core/infra/after-response';
import { sendMailSafely } from '@/core/mail/send-mail';
import { renderWelcomeMail } from '@/core/mail/templates';
import type { Locale } from '@/shared/i18n/locale';
import type { User } from '@supabase/supabase-js';

// A session for an account younger than this is the first one: the welcome mail (E1) goes out once.
const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

function firstName(user: User): string | null {
	const meta = user.user_metadata as Record<string, unknown> | undefined;
	const raw = [meta?.full_name, meta?.name, meta?.given_name].find(
		(value): value is string => typeof value === 'string' && value.trim().length > 0,
	);
	return raw ? (raw.trim().split(/\s+/)[0] ?? null) : null;
}

/** Sent once per account (dedupe key), after the first confirmed session, by link or by code. */
export function queueWelcomeMail(user: User, locale: Locale): void {
	const createdAt = Date.parse(user.created_at);
	if (!user.email || !user.email_confirmed_at || !Number.isFinite(createdAt)) return;
	if (Date.now() - createdAt > NEW_ACCOUNT_WINDOW_MS) return;
	const to = user.email;
	afterResponse(() =>
		sendMailSafely({
			kind: 'welcome',
			dedupeKey: `welcome:${user.id}`,
			to,
			mail: renderWelcomeMail({ firstName: firstName(user), locale }),
		}),
	);
}
