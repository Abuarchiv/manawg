import type { Message } from '@/shared/i18n/message';
import type { RecurrenceType } from './chore-types';

const NAMED_CADENCE: Record<RecurrenceType, Partial<Record<number, Message['key']>>> = {
	days: { 1: 'chores.cadence.daily', 7: 'chores.cadence.weekly' },
	months: {
		1: 'chores.cadence.monthly',
		3: 'chores.cadence.quarterly',
		6: 'chores.cadence.halfYearly',
		12: 'chores.cadence.yearly',
	},
};

/**
 * Short rhythm label of a chore for the narrow row: a named rhythm when one matches,
 * else "every N days" / "every N months". The catalog texts keep a non-breaking space
 * between the number and its unit.
 */
export function formatChoreCadence(interval: number, type: RecurrenceType): Message {
	if (interval <= 0) return { key: 'chores.cadence.oneOff' };
	const named = NAMED_CADENCE[type][interval];
	if (named) return { key: named };
	return {
		key: type === 'months' ? 'chores.cadence.everyMonths' : 'chores.cadence.everyDays',
		values: { count: interval },
	};
}
