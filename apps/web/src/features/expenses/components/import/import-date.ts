import { dayMonthOptions } from '@/core/utils/time';
import { dateTimeFormat } from '@/shared/i18n/intl';
import type { Locale } from '@/shared/i18n/locale';

/** A calendar day in the reader's locale; an unreadable `iso` is shown as is. */
export function formatImportDate(iso: string, locale: Locale, timeZone?: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return dateTimeFormat(locale, {
		...dayMonthOptions(locale, true),
		...(timeZone ? { timeZone } : {}),
	}).format(date);
}
