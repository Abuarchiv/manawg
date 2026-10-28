import type { Locale } from '@/shared/i18n/locale';

// German: "." groups thousands, "," is the decimal mark. English: the reverse.
const AMOUNT_NUMBER: Record<Locale, string> = {
	de: String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,5}(?:[,.]\d{1,2})?`,
	en: String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,5}(?:\.\d{1,2})?`,
};

// "euros" is accepted in English only; German keeps "Euro" and "EUR".
const EURO_WORD: Record<Locale, string> = { de: 'euro?|eur', en: 'euros?|eur' };

// Currency either before ("€ 35,50") or after ("35 Euro", "12,5 EUR", "35€") the number.
function amountPattern(locale: Locale): RegExp {
	const number = AMOUNT_NUMBER[locale];
	return new RegExp(
		String.raw`(?:^|\s)(?:€\s*(${number})|(${number})\s*(?:€|${EURO_WORD[locale]}))(?=[\s.,;:!?)]|$)`,
		'i',
	);
}

function normalizeAmountStr(raw: string, locale: Locale): string {
	if (locale === 'en') return raw.replace(/,/g, '');
	if (raw.includes(',')) return raw.replace(/\./g, '');
	if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) return raw.replace(/\./g, '');
	return raw;
}

interface AnnouncementPrefill {
	title: string;
	amountStr: string | null;
}

export function buildAnnouncementPrefill(content: string, locale: Locale): AnnouncementPrefill {
	const compact = content
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.join(' ')
		.slice(0, 120);
	const pattern = amountPattern(locale);
	const match = compact.match(pattern);
	const amount = match?.[1] ?? match?.[2];
	const amountStr = amount ? normalizeAmountStr(amount, locale) : null;
	const title = compact
		.replace(pattern, ' ')
		.replace(/\s+[.,;:!?)](?=\s|$)/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80);
	return {
		title: title || compact.slice(0, 80),
		amountStr,
	};
}

export function getAnnouncementPrefillHref(
	shareCode: string,
	target: 'shopping' | 'chore' | 'expense',
	prefill: AnnouncementPrefill,
): string {
	const params = new URLSearchParams();
	const encodedShareCode = encodeURIComponent(shareCode);
	if (target === 'shopping') {
		params.set('name', prefill.title);
		return `/wg/${encodedShareCode}/shopping?${params.toString()}`;
	}
	if (target === 'chore') {
		params.set('title', prefill.title);
		return `/wg/${encodedShareCode}/chores?${params.toString()}`;
	}
	params.set('desc', prefill.title);
	if (prefill.amountStr) params.set('amount', prefill.amountStr);
	return `/wg/${encodedShareCode}/expenses?${params.toString()}`;
}
