export const AMOUNT_MIN_EUROS = 0.01;
export const AMOUNT_MAX_EUROS = 1_000_000;
export const DESCRIPTION_MAX = 200;

export const RECURRING_INTERVAL_OPTIONS = [
	{ value: 1, label: '1 Monat' },
	{ value: 2, label: '2 Monate' },
	{ value: 3, label: 'Quartal' },
	{ value: 12, label: 'Jahr' },
] as const;

export const QUICK_EXPENSE_TEMPLATES: ReadonlyArray<{
	label: string;
	description: string;
	amount: string;
}> = [
	{ label: 'Wocheneinkauf', description: 'Wocheneinkauf', amount: '25,00' },
	{ label: 'Putzmittel', description: 'Putzmittel', amount: '8,00' },
	{ label: 'Internet', description: 'Internet', amount: '35,00' },
	{ label: 'Getränke', description: 'Getränke', amount: '12,00' },
];
