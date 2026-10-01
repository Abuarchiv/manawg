export const AMOUNT_MIN_EUROS = 0.01;
export const AMOUNT_MAX_EUROS = 1_000_000;
export const DESCRIPTION_MAX = 200;

export const RECURRING_INTERVAL_OPTIONS = [
	{ value: 1, label: '1 Monat' },
	{ value: 2, label: '2 Monate' },
	{ value: 3, label: 'Quartal' },
	{ value: 6, label: '6 Monate' },
	{ value: 12, label: 'Jahr' },
] as const;
