import type { RecurrenceType } from '@/features/chores/components/chore-types';
import type { Message } from '@/shared/i18n/message';

interface IntervalPreset {
	interval: number;
	unit: RecurrenceType;
	label: Message;
}

// Day-based presets (sub-month cadence). The 30-day preset is a fixed 30-day cycle; the
// month presets below avoid the 12×30=360-day drift over a year.
export const INTERVAL_PRESETS_DAYS: ReadonlyArray<IntervalPreset> = [
	{ interval: 1, unit: 'days', label: { key: 'chores.cadence.daily' } },
	{ interval: 3, unit: 'days', label: { key: 'chores.presets.everyDays', values: { count: 3 } } },
	{ interval: 7, unit: 'days', label: { key: 'chores.cadence.weekly' } },
	{ interval: 14, unit: 'days', label: { key: 'chores.presets.everyDays', values: { count: 14 } } },
	{ interval: 30, unit: 'days', label: { key: 'chores.presets.everyDays', values: { count: 30 } } },
	{ interval: 90, unit: 'days', label: { key: 'chores.presets.everyDays', values: { count: 90 } } },
];

// Month-based presets (calendar-accurate, no day-drift). Picking one of these
// flips `newRecurrenceType` to 'months' so the next due date advances by calendar months.
export const INTERVAL_PRESETS_MONTHS: ReadonlyArray<IntervalPreset> = [
	{ interval: 1, unit: 'months', label: { key: 'chores.cadence.monthly' } },
	{ interval: 3, unit: 'months', label: { key: 'chores.cadence.quarterly' } },
	{ interval: 6, unit: 'months', label: { key: 'chores.cadence.halfYearly' } },
	{ interval: 12, unit: 'months', label: { key: 'chores.cadence.yearly' } },
];

interface QuickChoreTemplate {
	title: Message;
	intervalDays: number;
	recurrenceType: RecurrenceType;
}

export const QUICK_CHORE_TEMPLATES: ReadonlyArray<QuickChoreTemplate> = [
	{ title: { key: 'chores.templates.bathroom' }, intervalDays: 7, recurrenceType: 'days' },
	{ title: { key: 'chores.templates.kitchen' }, intervalDays: 7, recurrenceType: 'days' },
	{ title: { key: 'chores.templates.rubbish' }, intervalDays: 3, recurrenceType: 'days' },
	{ title: { key: 'chores.templates.hallway' }, intervalDays: 14, recurrenceType: 'days' },
];
