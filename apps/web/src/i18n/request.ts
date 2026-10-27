import { LOCALE_COOKIE, resolveLocale } from '@/shared/i18n/locale';
import messages from '@/shared/i18n/messages';
import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

export default getRequestConfig(async () => {
	const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
	const locale = resolveLocale({
		cookie: cookieStore.get(LOCALE_COOKIE)?.value,
		acceptLanguage: headerStore.get('accept-language'),
	});
	return { locale, messages: messages[locale], timeZone: 'Europe/Berlin' };
});
