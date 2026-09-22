const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export function parseTimestamp(value: string | Date): number | null {
	const timestamp = new Date(value).getTime();
	return Number.isNaN(timestamp) ? null : timestamp;
}

export function parseValidDate(value: string | Date): Date | null {
	const timestamp = parseTimestamp(value);
	return timestamp === null ? null : new Date(timestamp);
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
	const date = parseValidDate(iso);
	if (!date) return 'Zeit unbekannt';
	const diff = now - date.getTime();

	// A diff at least a minute negative is a genuine future timestamp (e.g. a
	// mahnung cooldown's nextAllowedAt, always hours away). Without this
	// branch every future date fell into `diff < MS_PER_MINUTE` (any negative
	// number is < 60_000) and rendered as "gerade eben" — reading as "possible
	// again right now" for something that is, say, still 48h away.
	//
	// The `-MS_PER_MINUTE` cutoff (rather than `< 0`) is deliberate: a
	// just-sent chat message's `createdAt` routinely lands a few hundred ms
	// ahead of the reading client's `now` — ordinary clock skew plus the
	// round-trip before the optimistic render — which produced a small
	// negative diff and misfired this branch as "gleich" for a message that
	// had, from the user's point of view, already been sent. Below one
	// minute stays in the ordinary "gerade eben" bucket on the other branch.
	if (diff <= -MS_PER_MINUTE) {
		const until = -diff;
		if (until < MS_PER_HOUR) {
			const m = Math.floor(until / MS_PER_MINUTE);
			return `in ${m} Min`;
		}
		if (until < MS_PER_DAY) {
			const h = Math.floor(until / MS_PER_HOUR);
			return `in ${h} Std`;
		}
		if (until < 7 * MS_PER_DAY) {
			const d = Math.floor(until / MS_PER_DAY);
			return d === 1 ? 'morgen' : `in ${d} Tagen`;
		}
		return new Intl.DateTimeFormat('de-DE', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		}).format(date);
	}

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

	if (diff <= -MS_PER_MINUTE) {
		const until = -diff;
		if (until < MS_PER_HOUR) return `in ${Math.floor(until / MS_PER_MINUTE)} Min.`;
		if (until < MS_PER_DAY) return `in ${Math.floor(until / MS_PER_HOUR)} Std.`;
		const days = Math.floor(until / MS_PER_DAY);
		if (days < 7) return days === 1 ? 'morgen' : `in ${days} T.`;
		return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(date);
	}

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
