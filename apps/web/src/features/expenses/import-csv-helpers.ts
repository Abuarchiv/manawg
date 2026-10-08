import { CENTS_PER_EURO } from '@/core/utils/money';
import { AMOUNT_MAX_CENTS } from '@/features/expenses/expense-constants';
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
	const text = stripBom(input);
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
		normalized = /^-?\d{1,3}(?:,\d{3})+$/.test(normalized)
			? normalized.replace(/,/g, '')
			: normalized.replace(',', '.');
	} else if (/^-?[1-9]\d{0,2}(?:\.\d{3})+$/.test(normalized)) {
		normalized = normalized.replace(/\./g, '');
	}
	// Never round away sub-cent digits ("1.234" would silently become 1,23 €).
	if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
	const num = Number(normalized);
	if (!Number.isFinite(num)) return null;
	const cents = Math.round(num * CENTS_PER_EURO);
	if (!Number.isInteger(cents) || Math.abs(cents) > AMOUNT_MAX_CENTS) return null;
	return cents;
}

export function parseDateIso(raw: string): string | null {
	const value = raw.trim();
	if (!value) return null;
	const fromParts = (year: string, month: string, day: string): string | null => {
		const y = Number(year);
		if (y < MIN_PLAUSIBLE_YEAR || y > MAX_PLAUSIBLE_YEAR) return null;
		const m = Number(month);
		const d = Number(day);
		const date = new Date(Date.UTC(y, m - 1, d));
		if (
			Number.isNaN(date.getTime()) ||
			date.getUTCFullYear() !== y ||
			date.getUTCMonth() !== m - 1 ||
			date.getUTCDate() !== d
		) {
			return null;
		}
		return date.toISOString();
	};
	const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (isoMatch) {
		const [, y, m, d] = isoMatch;
		return fromParts(y ?? '', m ?? '', d ?? '');
	}
	const deMatch = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
	if (deMatch) {
		const [, d, m, y] = deMatch;
		const year = (y ?? '').length === 2 ? `20${y}` : y;
		return fromParts(year ?? '', m ?? '', d ?? '');
	}
	const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
	if (slash) {
		const [, m, d, y] = slash;
		const year = (y ?? '').length === 2 ? `20${y}` : y;
		return fromParts(year ?? '', m ?? '', d ?? '');
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
