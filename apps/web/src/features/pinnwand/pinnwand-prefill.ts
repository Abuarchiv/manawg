const AMOUNT_PATTERN =
	/(?:^|\s)(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,5}(?:[,.]\d{1,2})?)\s*(?:€|eur)(?=[\s.,;:!?)]|$)/i;

function normalizeAmountStr(raw: string): string {
	if (raw.includes(',')) return raw.replace(/\./g, '');
	if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) return raw.replace(/\./g, '');
	return raw;
}

interface PinnwandPrefill {
	title: string;
	amountStr: string | null;
}

export function buildPinnwandPrefill(content: string): PinnwandPrefill {
	const compact = content
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.join(' ')
		.slice(0, 120);
	const amount = compact.match(AMOUNT_PATTERN)?.[1];
	const amountStr = amount ? normalizeAmountStr(amount) : null;
	const title = compact
		.replace(AMOUNT_PATTERN, ' ')
		.replace(/\s+[.,;:!?)](?=\s|$)/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80);
	return {
		title: title || compact.slice(0, 80),
		amountStr,
	};
}

export function getPinnwandPrefillHref(
	shareCode: string,
	target: 'shopping' | 'chore' | 'expense',
	prefill: PinnwandPrefill,
): string {
	const params = new URLSearchParams();
	const encodedShareCode = encodeURIComponent(shareCode);
	if (target === 'shopping') {
		params.set('name', prefill.title);
		return `/wg/${encodedShareCode}/einkauf?${params.toString()}`;
	}
	if (target === 'chore') {
		params.set('title', prefill.title);
		return `/wg/${encodedShareCode}/putzen?${params.toString()}`;
	}
	params.set('desc', prefill.title);
	if (prefill.amountStr) params.set('amount', prefill.amountStr);
	return `/wg/${encodedShareCode}/ausgaben?${params.toString()}`;
}
