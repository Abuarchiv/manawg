import { parseTimestamp } from '@/core/utils/time';
import { dateTimeFormat } from '@/shared/i18n/intl';
import type { Locale } from '@/shared/i18n/locale';
import type { Message } from '@/shared/i18n/message';

type RecurringTemplateConflict = {
	description: string;
	amountCents: number;
	nextDueAt: string;
};

type RecurringAdvanceConflict = {
	nextDueAt: string;
};

const DUE_DATE_FORMAT: Record<Locale, Intl.DateTimeFormatOptions> = {
	de: { day: 'numeric', month: 'numeric', year: 'numeric' },
	en: { day: 'numeric', month: 'long', year: 'numeric' },
};

function formatDueDate(value: string, locale: Locale): string | Message {
	const timestamp = parseTimestamp(value);
	return timestamp === null
		? { key: 'offline.conflict.unknownDate' }
		: dateTimeFormat(locale, DUE_DATE_FORMAT[locale]).format(new Date(timestamp));
}

export function recurringTemplateConflictNote(
	template: RecurringTemplateConflict,
	locale: Locale,
): Message {
	return {
		key: 'offline.conflict.templateExists',
		values: { date: formatDueDate(template.nextDueAt, locale) },
	};
}

export function recurringAdvanceConflictNote(
	template: RecurringAdvanceConflict,
	expectedNextDueAt: string,
	locale: Locale,
): Message {
	const expected = formatDueDate(expectedNextDueAt, locale);
	if (template.nextDueAt === expectedNextDueAt) {
		return { key: 'offline.conflict.advanceSame', values: { expected } };
	}
	return {
		key: 'offline.conflict.advanceMoved',
		values: { server: formatDueDate(template.nextDueAt, locale), expected },
	};
}
