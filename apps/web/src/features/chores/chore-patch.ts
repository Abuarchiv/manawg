import type { ChoreRecurrenceType } from '@/core/db';

const INTERVAL_MAX_DAYS = 365;
const INTERVAL_MAX_MONTHS = 60;

interface ChoreCadence {
	intervalDays: number;
	recurrenceType: ChoreRecurrenceType;
	nextDueAt: Date;
}

interface ChorePatchInput {
	intervalDays?: number | undefined;
	recurrenceType?: ChoreRecurrenceType | undefined;
	nextDueAt?: string | undefined;
}

interface ChorePatchUpdate {
	intervalDays?: number;
	recurrenceType?: ChoreRecurrenceType;
	nextDueAt?: Date;
	anchorAt?: Date;
}

export function buildChorePatchUpdate(
	current: ChoreCadence,
	patch: ChorePatchInput,
): { update: ChorePatchUpdate; validCadence: boolean } {
	const recurrenceType = patch.recurrenceType ?? current.recurrenceType;
	const intervalDays = patch.intervalDays ?? current.intervalDays;
	const update: ChorePatchUpdate = {};

	if (patch.intervalDays !== undefined) update.intervalDays = patch.intervalDays;
	if (patch.recurrenceType !== undefined) update.recurrenceType = patch.recurrenceType;
	if (patch.nextDueAt !== undefined) {
		const nextDueAt = new Date(patch.nextDueAt);
		update.nextDueAt = nextDueAt;
		if (recurrenceType === 'months') update.anchorAt = nextDueAt;
	} else if (patch.recurrenceType === 'months' && current.recurrenceType !== 'months') {
		update.anchorAt = current.nextDueAt;
	}

	const maximum = recurrenceType === 'months' ? INTERVAL_MAX_MONTHS : INTERVAL_MAX_DAYS;
	return { update, validCadence: intervalDays >= 1 && intervalDays <= maximum };
}
