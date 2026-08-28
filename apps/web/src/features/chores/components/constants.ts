import type { RecurrenceType } from '@/features/chores/components/chore-types';

interface IntervalPreset {
	interval: number;
	unit: RecurrenceType;
	label: string;
}

// Day-based presets (legacy + sub-month cadence). 30d "monatlich" stays for
// users who explicitly want the old behavior, but new flows should prefer the
// month-unit "1 Monat" preset to avoid 12×30=360-day drift over a year.
export const INTERVAL_PRESETS_DAYS: ReadonlyArray<IntervalPreset> = [
	{ interval: 1, unit: 'days', label: 'täglich' },
	{ interval: 3, unit: 'days', label: 'alle 3 T.' },
	{ interval: 7, unit: 'days', label: 'wöchentlich' },
	{ interval: 14, unit: 'days', label: 'alle 14 T.' },
	{ interval: 30, unit: 'days', label: 'alle 30 T.' },
	{ interval: 90, unit: 'days', label: 'alle 90 T.' },
];

// Month-based presets (calendar-accurate, no day-drift). Picking one of these
// flips `newRecurrenceType` to 'months' so the server computes the next due
// via Date.setMonth instead of ms arithmetic.
export const INTERVAL_PRESETS_MONTHS: ReadonlyArray<IntervalPreset> = [
	{ interval: 1, unit: 'months', label: 'monatlich' },
	{ interval: 3, unit: 'months', label: 'quartalsweise' },
	{ interval: 6, unit: 'months', label: 'halbjährlich' },
	{ interval: 12, unit: 'months', label: 'jährlich' },
];

export const TITLE_MAX = 120;

export const QUICK_CHORE_TEMPLATES = [
	{ title: 'Bad putzen', intervalDays: 7, recurrenceType: 'days' as RecurrenceType },
	{ title: 'Küche wischen', intervalDays: 7, recurrenceType: 'days' as RecurrenceType },
	{ title: 'Müll rausbringen', intervalDays: 3, recurrenceType: 'days' as RecurrenceType },
	{ title: 'Flur saugen', intervalDays: 14, recurrenceType: 'days' as RecurrenceType },
] as const;
