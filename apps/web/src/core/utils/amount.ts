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

const DECIMAL_FORMAT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** German decimal text with at most two places: 1.5 is "1,5", 2 is "2". */
export function formatDecimal(value: number): string {
	return DECIMAL_FORMAT.format(value);
}
