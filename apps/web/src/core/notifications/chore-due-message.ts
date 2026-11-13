import { berlinCalendarDayDistance } from '@/core/utils/berlin-day';
import { formatShortDate } from '@/core/utils/time';
import type { Locale } from '@/shared/i18n/locale';
import type { PushT } from './notifications';

/** A bundled chore reminder names this many chores and counts the rest. */
const CHORE_TITLES_SHOWN = 2;

// Reminders fire on the due day and the day after, so the single-chore copy follows the Berlin
// calendar distance to nextDueAt. A bundle lists several chores without a day, so its wording
// stays neutral about when each was due.
export function choreDueBody(
	t: PushT,
	locale: Locale,
	payload: Record<string, unknown>,
	wgName: string,
): string {
	const titles = Array.isArray(payload.titles)
		? payload.titles.filter((title): title is string => typeof title === 'string')
		: [];
	if (titles.length > 1) {
		const shown = titles.slice(0, CHORE_TITLES_SHOWN).join(', ');
		const rest = titles.length - CHORE_TITLES_SHOWN;
		const list = rest > 0 ? `${shown} (+${rest})` : shown;
		return payload.unassigned === true
			? `${t('choreDue.manyOpen', { titles: list, wgName })} ${t('choreDue.unassigned')}`
			: t('choreDue.many', { titles: list });
	}
	const body = choreDueSentence(t, locale, payload, wgName);
	return payload.unassigned === true ? `${body} ${t('choreDue.unassigned')}` : body;
}

function choreDueSentence(
	t: PushT,
	locale: Locale,
	payload: Record<string, unknown>,
	wgName: string,
): string {
	const rawTitle = typeof payload.title === 'string' ? payload.title.trim() : '';
	const title = rawTitle.length > 0 ? rawTitle : t('fallback.task');
	const dueAt = typeof payload.nextDueAt === 'string' ? new Date(payload.nextDueAt) : null;
	if (!dueAt || Number.isNaN(dueAt.getTime())) return t('choreDue.today', { title, wgName });
	const diffDays = berlinCalendarDayDistance(new Date(), dueAt);
	if (diffDays < 0) return t('choreDue.overdue', { title, wgName, days: -diffDays });
	if (diffDays === 0) return t('choreDue.today', { title, wgName });
	if (diffDays === 1) return t('choreDue.tomorrow', { title, wgName });
	const date = formatShortDate(dueAt.toISOString(), 'Europe/Berlin', locale);
	return t('choreDue.onDate', { title, wgName, date });
}
