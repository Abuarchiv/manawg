import { dateTimeFormat } from '@/shared/i18n/intl';
import type { Locale } from '@/shared/i18n/locale';

const DAY_OPTIONS: Record<Locale, Intl.DateTimeFormatOptions> = {
	de: { day: '2-digit', month: '2-digit', year: 'numeric' },
	en: { day: 'numeric', month: 'short', year: 'numeric' },
};

/** A calendar day in the reader's locale; an unreadable `iso` is shown as is. */
export function formatImportDate(iso: string, locale: Locale, timeZone?: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return dateTimeFormat(locale, {
		...DAY_OPTIONS[locale],
		...(timeZone ? { timeZone } : {}),
	}).format(date);
}
