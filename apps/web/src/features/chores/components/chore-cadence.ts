import {
	INTERVAL_PRESETS_DAYS,
	INTERVAL_PRESETS_MONTHS,
} from '@/features/chores/components/constants';
import type { RecurrenceType } from './chore-types';

const NBSP = '\u00a0';

/**
 * Short rhythm label of a chore for the narrow row: the preset label when one matches,
 * else "alle N T." / "alle N Mon.". The non-breaking space keeps the unit abbreviation with
 * its number.
 */
export function formatChoreCadence(interval: number, type: RecurrenceType): string {
	if (interval <= 0) return 'einmalig';
	const presets = type === 'months' ? INTERVAL_PRESETS_MONTHS : INTERVAL_PRESETS_DAYS;
	const preset = presets.find((candidate) => candidate.interval === interval);
	if (preset) return preset.label.replace(' T.', `${NBSP}T.`);
	return `alle ${interval}${NBSP}${type === 'months' ? 'Mon.' : 'T.'}`;
}
