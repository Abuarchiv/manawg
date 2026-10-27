import { parseTimestamp } from '@/core/utils/time';

export type RecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type RecurrenceByDay = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

export interface RecurrenceRule {
	freq: RecurrenceFreq;
	interval: number;
	byDay?: RecurrenceByDay[];
	count?: number;
	until?: string;
	/** Starts of single occurrences that were taken out of the series (ISO instants, sorted). */
	exdates?: string[];
}
const FREQS: ReadonlySet<RecurrenceFreq> = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const BYDAYS: ReadonlySet<RecurrenceByDay> = new Set(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
export const RECURRENCE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: '', label: 'Einmalig' },
	{ value: 'DAILY', label: 'Täglich' },
	{ value: 'WEEKLY', label: 'Wöchentlich' },
	{ value: 'MONTHLY', label: 'Monatlich' },
	{ value: 'YEARLY', label: 'Jährlich' },
];
export const BYDAY_TO_INDEX: Record<RecurrenceByDay, number> = {
	SU: 0,
	MO: 1,
	TU: 2,
	WE: 3,
	TH: 4,
	FR: 5,
	SA: 6,
};
const MAX_OCCURRENCES = 366;
/** Longest list of removed occurrences one series keeps: about four years of a daily series, thirty of a weekly one. */
export const MAX_EXDATES = 1_500;

function isRecurrenceFreq(value: string): value is RecurrenceFreq {
	return FREQS.has(value as RecurrenceFreq);
}

function isRecurrenceByDay(value: string): value is RecurrenceByDay {
	return BYDAYS.has(value as RecurrenceByDay);
}

function parseExdates(value: string): string[] | null {
	const instants = new Set<string>();
	for (const item of value.split(',')) {
		const ts = parseTimestamp(item.trim());
		if (ts === null) return null;
		instants.add(new Date(ts).toISOString());
	}
	if (instants.size > MAX_EXDATES) return null;
	return [...instants].sort();
}

export function parseRecurrenceRule(value: string | null | undefined): RecurrenceRule | null {
	if (!value || typeof value !== 'string') return null;
	const parts = value.split(';').filter(Boolean);
	const map: Record<string, string> = {};
	for (const part of parts) {
		const eq = part.indexOf('=');
		if (eq <= 0) return null;
		const key = part.slice(0, eq).trim().toUpperCase();
		const val = part.slice(eq + 1).trim();
		if (!key || !val) return null;
		map[key] = val;
	}
	const freq = map.FREQ?.toUpperCase();
	if (!freq || !isRecurrenceFreq(freq)) return null;
	const intervalRaw = map.INTERVAL ?? '1';
	const interval = Number.parseInt(intervalRaw, 10);
	if (!Number.isFinite(interval) || interval < 1 || interval > 365) return null;
	const rule: RecurrenceRule = { freq, interval };
	if (map.BYDAY) {
		const days = map.BYDAY.split(',')
			.map((d) => d.trim().toUpperCase())
			.filter((d) => d.length > 0);
		const filtered: RecurrenceByDay[] = [];
		for (const day of days) {
			if (!isRecurrenceByDay(day)) return null;
			filtered.push(day);
		}
		if (filtered.length === 0) return null;
		rule.byDay = filtered;
	}
	if (map.COUNT) {
		const count = Number.parseInt(map.COUNT, 10);
		if (!Number.isFinite(count) || count < 1 || count > MAX_OCCURRENCES) return null;
		rule.count = count;
	}
	if (map.UNTIL) {
		const ts = parseTimestamp(map.UNTIL);
		if (ts === null) return null;
		rule.until = new Date(ts).toISOString();
	}
	if (map.EXDATE) {
		const exdates = parseExdates(map.EXDATE);
		if (!exdates) return null;
		rule.exdates = exdates;
	}
	return rule;
}

/** Canonical form of a submitted rule (`null` when empty), or `ok: false` when it cannot be parsed. */
export function canonicalRecurrenceRule(
	value: string | null | undefined,
): { ok: true; rule: string | null } | { ok: false } {
	if (!value) return { ok: true, rule: null };
	const parsed = parseRecurrenceRule(value);
	return parsed ? { ok: true, rule: formatRecurrenceRule(parsed) } : { ok: false };
}

export function formatRecurrenceRule(rule: RecurrenceRule): string {
	const parts: string[] = [`FREQ=${rule.freq}`];
	if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
	if (rule.byDay && rule.byDay.length > 0) parts.push(`BYDAY=${rule.byDay.join(',')}`);
	if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
	if (rule.until !== undefined) parts.push(`UNTIL=${rule.until}`);
	if (rule.exdates && rule.exdates.length > 0) parts.push(`EXDATE=${rule.exdates.join(',')}`);
	return parts.join(';');
}

/**
 * The rule with one occurrence taken out, or null when the rule is invalid, the occurrence is
 * already out, or the series already holds the most exceptions it may keep.
 */
export function withExcludedOccurrence(
	recurrence: string,
	occurrenceStartsAt: string,
): string | null {
	const rule = parseRecurrenceRule(recurrence);
	const ts = parseTimestamp(occurrenceStartsAt);
	if (!rule || ts === null) return null;
	const instant = new Date(ts).toISOString();
	const exdates = rule.exdates ?? [];
	if (exdates.includes(instant) || exdates.length >= MAX_EXDATES) return null;
	return formatRecurrenceRule({ ...rule, exdates: [...exdates, instant].sort() });
}

/** True when this exact occurrence start was taken out of the series. */
export function isExcludedOccurrence(rule: RecurrenceRule, startMs: number): boolean {
	return rule.exdates?.some((instant) => Date.parse(instant) === startMs) ?? false;
}
