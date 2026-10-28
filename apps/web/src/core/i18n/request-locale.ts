import type { NextRequest } from 'next/server';
import { LOCALE_COOKIE, type Locale, resolveLocale } from '@/shared/i18n/locale';

export function requestLocale(req: Pick<NextRequest, 'cookies' | 'headers'>): Locale {
	return resolveLocale({
		cookie: req.cookies.get(LOCALE_COOKIE)?.value,
		acceptLanguage: req.headers.get('accept-language'),
	});
}
