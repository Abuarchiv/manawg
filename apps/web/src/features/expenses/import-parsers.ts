import {
	detectDelimiter,
	distributeRemainder,
	findColumnIndex,
	lowerKey,
	parseAmountToCents,
	parseCsv,
	parseDateIso,
	stripBom,
} from './import-csv';

export { collectUniqueNames, findMappingConflicts, matchMembers } from './import-member-match';

const CUSTOM_SPLIT_MAX_DRIFT_CENTS = 2;

interface ParsedSplit {
	memberName: string;
	amountCents: number;
}

export interface ParsedExpense {
	date: string;
	description: string;
	amountCents: number;
	currency: 'EUR';
	paidByName: string;
	splits: ParsedSplit[];
	warnings: string[];
}

export type ImportSource = 'splitwise_csv' | 'splid_csv' | 'ocr_screenshot' | 'manual';

/**
 * A parsed row's `warnings` are internal codes (see `parseSplitwiseCsv`), not
 * UI text. This is the one place that turns them into German sentences for
 * `ImportPreviewTable`, so a new code can't accidentally leak to the screen
 * unmapped.
 */
export function describeParsedExpenseWarning(code: string): string {
	if (code.startsWith('unknown_columns_ignored:')) {
		const columns = code.slice('unknown_columns_ignored:'.length).split('|').filter(Boolean);
		return `Spalte${columns.length === 1 ? '' : 'n'} ${columns.map((name) => `„${name}“`).join(', ')} wurde${columns.length === 1 ? '' : 'n'} nicht erkannt und ignoriert.`;
	}
	if (code === 'custom_splits_drift_adjusted') {
		return 'Die Aufteilung wich minimal vom Gesamtbetrag ab und wurde automatisch angeglichen.';
	}
	if (code === 'custom_splits_discarded') {
		return 'Die eigene Aufteilung wich zu stark vom Gesamtbetrag ab und wurde verworfen — stattdessen gleichmäßig aufgeteilt.';
	}
	if (code === 'ocr_heuristic') {
		return 'Aus dem Bild erkannt: Prüfe Datum, Betrag und zahlende Person. Die Ausgabe wird nur der zahlenden Person zugeordnet, es entsteht keine Schuld.';
	}
	return code;
}

export class UnsupportedCurrencyError extends Error {
	readonly currency: string;
	constructor(currency: string) {
		super('Nur EUR-Importe unterstützt');
		this.name = 'UnsupportedCurrencyError';
		this.currency = currency;
	}
}

const SPLITWISE_KNOWN_COLS = new Set([
	'date',
	'datum',
	'description',
	'beschreibung',
	'notes',
	'notizen',
	'details',
	'repayments',
	'category',
	'kategorie',
	'cost',
	'kosten',
	'amount',
	'betrag',
	'currency',
	'wahrung',
	'created date',
	'created by',
	'last changed',
	'last modified by',
]);

export function parseSplitwiseCsv(csv: string): ParsedExpense[] {
	const firstNewline = csv.indexOf('\n');
	const headerLine = firstNewline === -1 ? csv : csv.slice(0, firstNewline);
	const delimiter = detectDelimiter(stripBom(headerLine));
	const rows = parseCsv(csv, delimiter);
	if (rows.length < 2) return [];
	const header = rows[0]?.fields ?? [];
	const idxDate = findColumnIndex(header, ['date', 'datum']);
	const idxDesc = findColumnIndex(header, ['description', 'beschreibung']);
	const idxCost = findColumnIndex(header, ['cost', 'kosten', 'amount', 'betrag']);
	const idxCurrency = findColumnIndex(header, ['currency', 'währung', 'wahrung']);
	if (idxDate === -1 || idxDesc === -1 || idxCost === -1) return [];

	const memberColumns: { index: number; name: string }[] = [];
	const ignoredColumns: string[] = [];
	for (let i = 0; i < header.length; i += 1) {
		const raw = (header[i] ?? '').trim();
		const key = lowerKey(raw);
		if (!key) continue;
		if (SPLITWISE_KNOWN_COLS.has(key) || key.startsWith('wahrung')) continue;
		const hasAmount = rows.slice(1).some((row) => {
			const value = (row.fields[i] ?? '').trim();
			return value !== '' && parseAmountToCents(value) !== null;
		});
		if (!hasAmount) {
			ignoredColumns.push(raw);
			continue;
		}
		memberColumns.push({ index: i, name: raw });
	}

	const out: ParsedExpense[] = [];
	for (let r = 1; r < rows.length; r += 1) {
		const fields = rows[r]?.fields ?? [];
		const warnings: string[] = [];
		if (ignoredColumns.length > 0) {
			warnings.push(`unknown_columns_ignored:${ignoredColumns.join('|')}`);
		}
		const descRaw = (fields[idxDesc] ?? '').trim();
		if (!descRaw || /^total/i.test(descRaw)) continue;
		const date = parseDateIso(fields[idxDate] ?? '');
		if (!date) {
			warnings.push('date_invalid');
			continue;
		}
		const totalCents = parseAmountToCents(fields[idxCost] ?? '');
		if (totalCents === null || totalCents <= 0) {
			warnings.push('amount_invalid');
			continue;
		}
		const currencyRaw =
			idxCurrency === -1 ? 'EUR' : (fields[idxCurrency] ?? 'EUR').trim().toUpperCase();
		if (currencyRaw && currencyRaw !== 'EUR') {
			throw new UnsupportedCurrencyError(currencyRaw);
		}

		let paidByName = '';
		let paidByColIndex = -1;
		let paidByValue = Number.NEGATIVE_INFINITY;
		for (const col of memberColumns) {
			const raw = (fields[col.index] ?? '').trim();
			if (!raw) continue;
			const signedCents = parseAmountToCents(raw);
			if (signedCents === null) continue;
			if (signedCents > paidByValue) {
				paidByValue = signedCents;
				paidByName = col.name;
				paidByColIndex = col.index;
			}
		}
		if (!paidByName && memberColumns[0]) {
			paidByName = memberColumns[0].name;
			paidByColIndex = memberColumns[0].index;
		}

		// Splitwise's per-person columns hold each person's NET balance on the
		// row, not their share: a debtor's column is `-share` (matches
		// Math.abs below), but the payer's column is `paid - ownShare`, so
		// their share has to be recovered as `total - net` — using the raw
		// abs value for the payer too under-detects real custom splits as
		// "drift" and silently discards them (see customSplits below).
		const parsedMemberAmounts = memberColumns
			.map((col) => {
				const raw = (fields[col.index] ?? '').trim();
				const signedCents = raw ? parseAmountToCents(raw) : null;
				if (signedCents === null || signedCents === 0) return null;
				const amountCents =
					col.index === paidByColIndex ? totalCents - signedCents : Math.abs(signedCents);
				return amountCents <= 0 ? null : { memberName: col.name, amountCents };
			})
			.filter((amount): amount is ParsedSplit => Boolean(amount));
		const customTotal = parsedMemberAmounts.reduce((acc, amount) => acc + amount.amountCents, 0);
		const drift = totalCents - customTotal;
		let customSplits: ParsedSplit[] | null = null;
		if (parsedMemberAmounts.length > 0) {
			if (drift === 0) {
				customSplits = parsedMemberAmounts;
			} else if (Math.abs(drift) <= CUSTOM_SPLIT_MAX_DRIFT_CENTS) {
				let maxIdx = 0;
				for (let i = 1; i < parsedMemberAmounts.length; i += 1) {
					if (
						(parsedMemberAmounts[i]?.amountCents ?? 0) >
						(parsedMemberAmounts[maxIdx]?.amountCents ?? 0)
					) {
						maxIdx = i;
					}
				}
				customSplits = parsedMemberAmounts.map((split, idx) =>
					idx === maxIdx ? { ...split, amountCents: split.amountCents + drift } : split,
				);
				warnings.push('custom_splits_drift_adjusted');
			} else {
				warnings.push('custom_splits_discarded');
			}
		}
		if (customSplits) {
			out.push({
				date,
				description: descRaw,
				amountCents: totalCents,
				currency: 'EUR',
				paidByName,
				splits: customSplits,
				warnings,
			});
			continue;
		}

		const participants = memberColumns.filter((col) => {
			const raw = (fields[col.index] ?? '').trim();
			if (!raw) return false;
			const cents = parseAmountToCents(raw);
			return cents !== null && cents !== 0;
		});
		if (participants.length === 0) {
			warnings.push('no_participants');
			continue;
		}
		const baseShare = Math.floor(totalCents / participants.length);
		const rawShares = participants.map(() => baseShare);
		const finalShares = distributeRemainder(totalCents, rawShares);
		const splits: ParsedSplit[] = participants.map((col, idx) => ({
			memberName: col.name,
			amountCents: finalShares[idx] ?? baseShare,
		}));

		out.push({
			date,
			description: descRaw,
			amountCents: totalCents,
			currency: 'EUR',
			paidByName,
			splits,
			warnings,
		});
	}
	return out;
}

export function parseSplidCsv(csv: string): ParsedExpense[] {
	const firstNewline = csv.indexOf('\n');
	const headerLine = firstNewline === -1 ? csv : csv.slice(0, firstNewline);
	const delimiter = detectDelimiter(stripBom(headerLine));
	const rows = parseCsv(csv, delimiter);
	if (rows.length < 2) return [];
	const header = rows[0]?.fields ?? [];
	const idxDate = findColumnIndex(header, ['datum', 'date']);
	const idxDesc = findColumnIndex(header, ['beschreibung', 'titel', 'description']);
	const idxAmount = findColumnIndex(header, ['betrag', 'kosten', 'amount']);
	const idxPaidBy = findColumnIndex(header, ['bezahlt von', 'zahler', 'payer', 'paid by']);
	const idxParticipants = findColumnIndex(header, ['teilnehmer', 'participants', 'für']);
	const idxCurrency = findColumnIndex(header, ['währung', 'wahrung', 'currency']);
	if (idxDate === -1 || idxDesc === -1 || idxAmount === -1 || idxPaidBy === -1) return [];

	const out: ParsedExpense[] = [];
	for (let r = 1; r < rows.length; r += 1) {
		const fields = rows[r]?.fields ?? [];
		const warnings: string[] = [];
		const descRaw = (fields[idxDesc] ?? '').trim();
		if (!descRaw) continue;
		const date = parseDateIso(fields[idxDate] ?? '');
		if (!date) {
			warnings.push('date_invalid');
			continue;
		}
		const totalCents = parseAmountToCents(fields[idxAmount] ?? '');
		if (totalCents === null || totalCents <= 0) {
			warnings.push('amount_invalid');
			continue;
		}
		const paidByName = (fields[idxPaidBy] ?? '').trim();
		if (!paidByName) {
			warnings.push('payer_missing');
			continue;
		}
		if (idxCurrency !== -1) {
			const currencyRaw = (fields[idxCurrency] ?? 'EUR').trim().toUpperCase();
			if (currencyRaw && currencyRaw !== 'EUR') {
				throw new UnsupportedCurrencyError(currencyRaw);
			}
		}
		const participantsRaw =
			idxParticipants === -1 ? paidByName : (fields[idxParticipants] ?? '').trim();
		const participants = participantsRaw
			.split(/[,;|]/)
			.map((s) => s.trim())
			.filter(Boolean);
		const finalParticipants = participants.length === 0 ? [paidByName] : participants;
		const baseShare = Math.floor(totalCents / finalParticipants.length);
		const rawShares = finalParticipants.map(() => baseShare);
		const shares = distributeRemainder(totalCents, rawShares);
		const splits: ParsedSplit[] = finalParticipants.map((name, idx) => ({
			memberName: name,
			amountCents: shares[idx] ?? baseShare,
		}));

		out.push({
			date,
			description: descRaw,
			amountCents: totalCents,
			currency: 'EUR',
			paidByName,
			splits,
			warnings,
		});
	}
	return out;
}
