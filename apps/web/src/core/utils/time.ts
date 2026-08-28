const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export function parseTimestamp(value: string | Date): number | null {
	const timestamp = new Date(value).getTime();
	return Number.isNaN(timestamp) ? null : timestamp;
}

function parseValidDate(value: string | Date): Date | null {
	const timestamp = parseTimestamp(value);
	return timestamp === null ? null : new Date(timestamp);
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
	const date = parseValidDate(iso);
	if (!date) return 'Zeit unbekannt';
	const diff = now - date.getTime();

	if (diff < MS_PER_MINUTE) return 'gerade eben';
	if (diff < MS_PER_HOUR) {
		const m = Math.floor(diff / MS_PER_MINUTE);
		return `vor ${m} Min`;
	}
	if (diff < MS_PER_DAY) {
		const h = Math.floor(diff / MS_PER_HOUR);
		return `vor ${h} Std`;
	}
	if (diff < 7 * MS_PER_DAY) {
		const d = Math.floor(diff / MS_PER_DAY);
		return d === 1 ? 'gestern' : `vor ${d} Tagen`;
	}
	return new Intl.DateTimeFormat('de-DE', {
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date);
}

export function formatCompactRelativeTime(iso: string, now = Date.now()): string {
	const date = parseValidDate(iso);
	if (!date) return 'unbekannt';
	const diff = now - date.getTime();

	if (diff < MS_PER_MINUTE) return 'jetzt';
	if (diff < MS_PER_HOUR) return `${Math.round(diff / MS_PER_MINUTE)} Min.`;
	if (diff < MS_PER_DAY) return `${Math.round(diff / MS_PER_HOUR)} Std.`;
	const days = Math.round(diff / MS_PER_DAY);
	if (days < 7) return `${days} T.`;
	return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(date);
}

export function formatShortDate(iso: string): string {
	const date = parseValidDate(iso);
	if (!date) return 'Datum unbekannt';
	return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(date);
}

export function formatShortDateRange(startIso: string, endIso: string): string {
	return `${formatShortDate(startIso)} bis ${formatShortDate(endIso)}`;
}

export function formatTimeFull(iso: string): string {
	const date = parseValidDate(iso);
	if (!date) return 'Zeit unbekannt';
	return new Intl.DateTimeFormat('de-DE', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date);
}
