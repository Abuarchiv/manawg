/** Formatting and due-date helpers shared by the dashboard insight builders. */
import { berlinCalendarDayDistance } from '@/core/utils/berlin-day';
import { formatEuroCents } from '@/core/utils/money';
import { parseTimestamp } from '@/core/utils/time';

export function formatEuro(cents: number, currency = 'EUR'): string {
	return formatEuroCents(cents, currency);
}

export function formatCurrencyTotals(totals: Readonly<Record<string, number>>): string {
	const entries = Object.entries(totals)
		.filter(([, cents]) => cents !== 0)
		.sort(([left], [right]) => left.localeCompare(right));
	return entries.length > 0
		? entries.map(([currency, cents]) => formatEuro(cents, currency)).join(' · ')
		: formatEuro(0);
}

function calendarDayDistance(iso: string, now: number): number | null {
	const dueAt = parseTimestamp(iso);
	return dueAt === null ? null : berlinCalendarDayDistance(new Date(now), new Date(dueAt));
}

export function dueLabel(iso: string, now: number): string {
	const days = calendarDayDistance(iso, now);
	if (days === null) return 'Datum prüfen';
	if (days < 0) {
		const n = Math.abs(days);
		return `seit ${n} ${n === 1 ? 'Tag' : 'Tagen'} offen`;
	}
	if (days === 0) return 'heute fällig';
	if (days === 1) return 'morgen fällig';
	return `in ${days} Tagen`;
}

export function choreUrgency(iso: string, now: number): number {
	const days = calendarDayDistance(iso, now);
	if (days === null) return 4;
	if (days < 0) return 0;
	if (days === 0) return 1;
	if (days <= 3) return 2;
	return 3;
}
