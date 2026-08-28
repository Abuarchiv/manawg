export function parseEuroAmount(value: string): number | null {
	const normalized = value.trim().replace(',', '.');
	if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
	const amount = Number(normalized);
	return Number.isFinite(amount) ? amount : null;
}

export function formatEuroInput(value: number): string {
	return value.toFixed(2).replace('.', ',');
}
