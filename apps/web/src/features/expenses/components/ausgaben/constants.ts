export const AMOUNT_MIN_EUROS = 0.01;
export const AMOUNT_MAX_EUROS = 1_000_000;
export const DESCRIPTION_MAX = 200;

// Über dem Maximum wäre „über 0 €“ irreführend: der Betrag ist dann zu groß, nicht zu klein.
export function amountErrorMessage(euros: number | null, raw = ''): string {
	if (euros === null && /[.,]\d{3,}\s*(€|EUR)?$/i.test(raw.trim())) {
		return 'Maximal zwei Nachkommastellen.';
	}
	return euros !== null && euros > AMOUNT_MAX_EUROS
		? 'Der Betrag darf höchstens 1.000.000 € betragen.'
		: 'Gib einen Betrag über 0 € ein, z. B. 12,50.';
}

export const RECURRING_INTERVAL_OPTIONS = [
	{ value: 1, label: '1 Monat' },
	{ value: 2, label: '2 Monate' },
	{ value: 3, label: 'Quartal' },
	{ value: 6, label: '6 Monate' },
	{ value: 12, label: 'Jahr' },
] as const;
