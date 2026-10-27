import { CENTS_PER_EURO } from '@/core/utils/money';

export function parseEuroAmount(value: string): number | null {
	// Pasted amounts carry "€" / "EUR" and space-grouped thousands: "12,50 €", "1 234,50".
	const trimmed = value
		.replace(/€|EUR/gi, '')
		.trim()
		.replace(
			/^(\d{1,3})((?:[\s  ]\d{3})+)(?=,|$)/,
			(_, head: string, rest: string) => head + rest.replace(/\s/g, '').replace(/[  ]/g, ''),
		);
	// German thousands dots ("1.234,56", "1.200") — only in the strict 3-digit-group form.
	const normalized = /^\d{1,3}(?:\.\d{3})+(?:,\d{0,2})?$/.test(trimmed)
		? trimmed.replace(/\./g, '').replace(',', '.')
		: trimmed.replace(',', '.');
	if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized)) return null;
	const amount = Number(normalized);
	return Number.isFinite(amount) ? amount : null;
}

export function formatEuroInput(value: number): string {
	return value.toFixed(2).replace('.', ',');
}

/** Euro amount to whole cents; rounds, so 0.1 + 0.2 euros is 30 cents. */
export function eurosToCents(euros: number): number {
	return Math.round(euros * CENTS_PER_EURO);
}

/** Cent amount as the German euro text of an amount input ("12,50"). */
export function formatCentsInput(cents: number): string {
	return formatEuroInput(cents / CENTS_PER_EURO);
}
