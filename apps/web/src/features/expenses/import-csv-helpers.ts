import { eurosToCents } from '@/core/utils/amount';
import { AMOUNT_MAX_CENTS } from '@/features/expenses/expense-constants';
import { DEFAULT_LOCALE, type Locale } from '@/shared/i18n/locale';
import { type ParsedSplit, type RejectedRow, UNKNOWN_NAME } from './import-types';

const MIN_PLAUSIBLE_YEAR = 2000;
const MAX_PLAUSIBLE_YEAR = 2100;
const BOM = '﻿';

export function normalizeMemberName(name: string): string {
	return name
		.normalize('NFD')
		.replace(/̀|́|̂|̃|̄|̆|̇|̈|̊|̋|̌|̧/g, '')
		.toLowerCase()
		.trim()
		.replace(/\s+/g, ' ');
}

export function stripBom(input: string): string {
	return input.startsWith(BOM) ? input.slice(BOM.length) : input;
}

export function detectDelimiter(line: string): string {
	const semi = (line.match(/;/g) ?? []).length;
	const comma = (line.match(/,/g) ?? []).length;
	return semi > comma ? ';' : ',';
}

export interface CsvRow {
	fields: string[];
	lineNumber: number;
}

export function parseCsv(input: string, delimiter: string): CsvRow[] {
	const rows: CsvRow[] = [];
	let field = '';
	let row: string[] = [];
	let inQuotes = false;
	let lineNumber = 1;
	let rowStartLine = 1;
	let i = 0;
	const text = stripBom(input).replaceAll(UNKNOWN_NAME, '');
	while (i < text.length) {
		const ch = text[i];
		const next = text[i + 1];
		if (inQuotes) {
			if (ch === '"' && next === '"') {
				field += '"';
				i += 2;
				continue;
			}
			if (ch === '"') {
				inQuotes = false;
				i += 1;
				continue;
			}
			if (ch === '\n') lineNumber += 1;
			field += ch;
			i += 1;
			continue;
		}
		if (ch === '"') {
			inQuotes = true;
			i += 1;
			continue;
		}
		if (ch === delimiter) {
			row.push(field);
			field = '';
			i += 1;
			continue;
		}
		if (ch === '\r' && next === '\n') {
			row.push(field);
			rows.push({ fields: row, lineNumber: rowStartLine });
			field = '';
			row = [];
			i += 2;
			lineNumber += 1;
			rowStartLine = lineNumber;
			continue;
		}
		if (ch === '\n' || ch === '\r') {
			row.push(field);
			rows.push({ fields: row, lineNumber: rowStartLine });
			field = '';
			row = [];
			i += 1;
			lineNumber += 1;
			rowStartLine = lineNumber;
			continue;
		}
		field += ch;
		i += 1;
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push({ fields: row, lineNumber: rowStartLine });
	}
	return rows.filter((r) => r.fields.some((f) => f.trim().length > 0));
}

export function parseAmountToCents(raw: string): number | null {
	const trimmed = raw.trim().replace(/€|EUR/gi, '').trim();
	if (!trimmed) return null;
	let normalized = trimmed.replace(/\s/g, '');
	const lastComma = normalized.lastIndexOf(',');
	const lastDot = normalized.lastIndexOf('.');
	if (lastComma > -1 && lastDot > -1) {
		// Whichever separator comes last is the decimal mark.
		normalized =
			lastComma > lastDot
				? normalized.replace(/\./g, '').replace(',', '.')
				: normalized.replace(/,/g, '');
	} else if (lastComma > -1) {
		// A lone comma is a decimal mark ("12,5" = 12,50 €) unless it only
		// ever separates 3-digit groups ("1,234" / "1,234,567").
		normalized = /^-?[1-9]\d{0,2}(?:,\d{3})+$/.test(normalized)
			? normalized.replace(/,/g, '')
			: normalized.replace(',', '.');
	} else if (/^-?[1-9]\d{0,2}(?:\.\d{3})+$/.test(normalized)) {
		normalized = normalized.replace(/\./g, '');
	}
	// Never round away sub-cent digits ("1.234" would silently become 1,23 €).
	if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
	const num = Number(normalized);
	if (!Number.isFinite(num)) return null;
	const cents = eurosToCents(num);
	if (!Number.isInteger(cents) || Math.abs(cents) > AMOUNT_MAX_CENTS) return null;
	return cents;
}

/**
 * UTC-noon ISO timestamp of an exact calendar date, or null. Noon keeps the calendar day in every
 * time zone from UTC-12 to UTC+11, like the local-noon stamp of manually entered dates. A two-digit
 * year means 20yy; years outside the plausible range and dates like 31.02. are rejected.
 */
export function parseDayMonthYear(day: string, month: string, year: string): string | null {
	const y = Number(year.length === 2 ? `20${year}` : year);
	if (!(y >= MIN_PLAUSIBLE_YEAR && y <= MAX_PLAUSIBLE_YEAR)) return null;
	const m = Number(month);
	const d = Number(day);
	const date = new Date(Date.UTC(y, m - 1, d, 12));
	if (
		Number.isNaN(date.getTime()) ||
		date.getUTCFullYear() !== y ||
		date.getUTCMonth() !== m - 1 ||
		date.getUTCDate() !== d
	) {
		return null;
	}
	return date.toISOString();
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const GERMAN_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/;
// Slash dates are ambiguous: German-language imports read them month first (US export order),
// English-language imports day first (en-GB export order).
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/;

export function parseDateIso(raw: string, locale: Locale = DEFAULT_LOCALE): string | null {
	const value = raw.trim();
	const iso = value.match(ISO_DATE);
	if (iso) {
		const [, year = '', month = '', day = ''] = iso;
		return parseDayMonthYear(day, month, year);
	}
	const german = value.match(GERMAN_DATE);
	if (german) {
		const [, day = '', month = '', year = ''] = german;
		return parseDayMonthYear(day, month, year);
	}
	const slash = value.match(SLASH_DATE);
	if (slash) {
		const [, first = '', second = '', year = ''] = slash;
		return locale === 'en'
			? parseDayMonthYear(first, second, year)
			: parseDayMonthYear(second, first, year);
	}
	return null;
}

export function lowerKey(key: string): string {
	return normalizeMemberName(key);
}

export function findColumnIndex(headers: readonly string[], candidates: readonly string[]): number {
	const lowered = headers.map(lowerKey);
	for (const candidate of candidates) {
		const idx = lowered.indexOf(lowerKey(candidate));
		if (idx !== -1) return idx;
	}
	return -1;
}

export function distributeRemainder(total: number, shares: number[]): number[] {
	const sum = shares.reduce((acc, n) => acc + n, 0);
	const diff = total - sum;
	if (diff === 0 || shares.length === 0) return shares;
	const out = [...shares];
	if (diff > 0) {
		for (let k = 0; k < diff; k += 1) {
			const idx = k % out.length;
			out[idx] = (out[idx] ?? 0) + 1;
		}
	} else {
		const sorted = out.map((amount, idx) => ({ amount, idx })).sort((a, b) => b.amount - a.amount);
		for (let k = 0; k < -diff; k += 1) {
			const target = sorted[k % sorted.length];
			if (!target) break;
			out[target.idx] = (out[target.idx] ?? 0) - 1;
		}
	}
	return out;
}

/**
 * Only EUR is supported, but one foreign-currency row must not sink the whole
 * file: the preview lists rejected rows one by one. Callers without a
 * `rejected` channel still abort, which is what the commit route relies on
 * when it re-parses a payload the preview already cleared.
 */
export function rejectForeignCurrencyRow(
	rejected: RejectedRow[] | undefined,
	line: number,
	currency: string,
	description: string,
): boolean {
	if (!rejected) return false;
	rejected.push({
		line,
		reason: 'currency_unsupported',
		description: `${description} (${currency})`,
	});
	return true;
}

/** How many header rows to scan for the column names; exports may carry a title line above them. */
const HEADER_SCAN_ROWS = 15;
const DELIMITER_CANDIDATES = [',', ';', '\t'];

/**
 * Reads a CSV whose header row is not necessarily the first line (a sheet saved from Excel starts
 * with the group name) and whose delimiter is not known up front. `isHeader` decides which row
 * holds the column names; the rows below it are returned with their file line numbers.
 */
export function readCsvTable(
	csv: string,
	isHeader: (fields: string[]) => boolean,
): { header: string[]; rows: CsvRow[] } | null {
	const firstNewline = csv.indexOf('\n');
	const firstLine = firstNewline === -1 ? csv : csv.slice(0, firstNewline);
	const guess = detectDelimiter(stripBom(firstLine));
	const delimiters = [guess, ...DELIMITER_CANDIDATES.filter((d) => d !== guess)];
	for (const delimiter of delimiters) {
		const rows = parseCsv(csv, delimiter);
		const headerIndex = rows.slice(0, HEADER_SCAN_ROWS).findIndex((row) => isHeader(row.fields));
		const headerRow = rows[headerIndex];
		if (headerRow) return { header: headerRow.fields, rows: rows.slice(headerIndex + 1) };
	}
	return null;
}

const YEAR_FIRST_DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?!\d)/;
const NUMERIC_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?!\d)/;

/**
 * Whether slash dates in one file read day first. The file decides (a first number above 12 means
 * day first, a second one means month first); an undecided file reads day first, like both apps.
 */
export function detectDayFirst(values: readonly string[]): boolean {
	for (const value of values) {
		const match = value.trim().match(NUMERIC_DATE);
		if (!match) continue;
		if (Number(match[1]) > 12) return true;
		if (Number(match[2]) > 12) return false;
	}
	return true;
}

/** `parseDateIso` for exports whose slash and dash dates follow the file, not the UI language. */
export function parseExportDate(raw: string, dayFirst: boolean): string | null {
	const yearFirst = raw.trim().match(YEAR_FIRST_DATE);
	if (yearFirst) {
		const [, year = '', month = '', day = ''] = yearFirst;
		return parseDayMonthYear(day, month, year);
	}
	const match = raw.trim().match(NUMERIC_DATE);
	if (!match) return parseDateIso(raw);
	const [, first = '', second = '', year = ''] = match;
	return dayFirst ? parseDayMonthYear(first, second, year) : parseDayMonthYear(second, first, year);
}

/** An amount in euros that may carry more than two decimals ("4.055"), as a plain number. */
export function parseDecimal(raw: string): number | null {
	const trimmed = raw.trim().replace(/\s/g, '');
	if (!trimmed) return null;
	const normalized = trimmed.includes('.') ? trimmed.replace(/,/g, '') : trimmed.replace(',', '.');
	if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
	return Number(normalized);
}

const WEIGHT_SCALE = 1_000_000;

/**
 * Weights that already are whole cents adding up to the total are the file's own split and stay as
 * they are. Anything else (ratios, sub-cent amounts, a split that misses the total) is allocated
 * proportionally in exact integer math, the largest remainders getting the leftover cents.
 */
function allocateShares(totalCents: number, weights: readonly number[]): number[] {
	const exact = weights.map((w) => Math.round(w * 100));
	if (exact.reduce((acc, n) => acc + n, 0) === totalCents) return exact;
	const scaled = weights.map((w) => BigInt(Math.max(1, Math.round(w * WEIGHT_SCALE))));
	const sum = scaled.reduce((acc, n) => acc + n, BigInt(0));
	const total = BigInt(totalCents);
	const parts = scaled.map((w, idx) => ({
		idx,
		cents: (total * w) / sum,
		remainder: (total * w) % sum,
	}));
	let leftover = Number(total - parts.reduce((acc, p) => acc + p.cents, BigInt(0)));
	const byRemainder = [...parts].sort((a, b) =>
		a.remainder === b.remainder ? a.idx - b.idx : a.remainder > b.remainder ? -1 : 1,
	);
	for (const part of byRemainder) {
		if (leftover <= 0) break;
		part.cents += BigInt(1);
		leftover -= 1;
	}
	return parts.map((p) => Number(p.cents));
}

/**
 * Splits `totalCents` in proportion to `weights` (exact amounts or plain ratios) so the shares add
 * up to the total to the cent. `drifted` is set when the weights, read as euros, miss the total by
 * more than their own rounding, which means the file's split does not match its amount.
 */
export function splitProportionally(
	totalCents: number,
	entries: readonly { memberName: string; weight: number }[],
): { splits: ParsedSplit[]; drifted: boolean } {
	const valid = entries.filter((e) => Number.isFinite(e.weight) && e.weight > 0);
	const weightSum = valid.reduce((acc, e) => acc + e.weight, 0);
	if (valid.length === 0 || weightSum <= 0) return { splits: [], drifted: false };
	const shares = allocateShares(
		totalCents,
		valid.map((e) => e.weight),
	);
	const splits = valid
		.map((e, i) => ({ memberName: e.memberName, amountCents: shares[i] ?? 0 }))
		.filter((split) => split.amountCents > 0);
	const drifted = Math.abs(weightSum * 100 - totalCents) > valid.length / 2 + 1e-6;
	return { splits, drifted };
}
