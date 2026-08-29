import { parseTimestamp } from '@/core/utils/time';

// `cn` moved to @/shared/lib/cn — Drawer (now in apps/landing) needs it
// too, so it can't stay app-local. Re-export here so the many in-app call
// sites don't all need an import-path change.
export { cn } from '@/shared/lib/cn';

export function formatDate(date: string | Date, locale = 'de-DE'): string {
	const timestamp = parseTimestamp(date);
	if (timestamp === null) return 'Datum unbekannt';
	return new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	}).format(new Date(timestamp));
}

export function formatRelativeDate(date: string | Date): string {
	const timestamp = parseTimestamp(date);
	if (timestamp === null) return 'Datum unbekannt';
	const now = new Date();
	const diffMs = now.getTime() - timestamp;
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHrs = Math.floor(diffMin / 60);
	const diffDays = Math.floor(diffHrs / 24);

	if (diffSec < 60) return 'gerade eben';
	if (diffMin < 60) return `vor ${diffMin} Minute${diffMin === 1 ? '' : 'n'}`;
	if (diffHrs < 24) return `vor ${diffHrs} Stunde${diffHrs === 1 ? '' : 'n'}`;
	if (diffDays === 1) return 'gestern';
	if (diffDays < 7) return `vor ${diffDays} Tagen`;
	return formatDate(date);
}
