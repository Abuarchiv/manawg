import { MS_PER_DAY } from '@/core/utils/time';

const SOLO_SNOOZE_DAYS = 7;

/**
 * Whether the Start card stays hidden for the stored dismissal.
 *
 * Alone in the WG a dismissal is a snooze: the stored value is the dismissal time and the card
 * returns after a week (the legacy value "1" counts as long expired). With flatmates a dismissal
 * is permanent; a snooze left over from the solo time does not hide the new "is in" card.
 */
export function isWelcomeHidden(raw: string | null, now: number, solo: boolean): boolean {
	if (raw === null) return false;
	if (!solo) return raw === '1';
	const snoozedAt = Number(raw);
	// A timestamp from the future (the clock was corrected) must not hide the card for over a week.
	return snoozedAt <= now && now < snoozedAt + SOLO_SNOOZE_DAYS * MS_PER_DAY;
}

/** The value to store when the card is dismissed. */
export function welcomeDismissalValue(now: number, solo: boolean): string {
	return solo ? String(now) : '1';
}
