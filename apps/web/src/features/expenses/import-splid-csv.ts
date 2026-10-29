import { DEFAULT_LOCALE, type Locale } from '@/shared/i18n/locale';
import {
	detectDelimiter,
	distributeRemainder,
	findColumnIndex,
	parseAmountToCents,
	parseCsv,
	parseDateIso,
	rejectForeignCurrencyRow,
	stripBom,
} from './import-csv-helpers';
import {
	type ParsedExpense,
	type ParsedSplit,
	type RejectedRow,
	UnsupportedCurrencyError,
} from './import-types';

export function parseSplidCsv(
	csv: string,
	rejected?: RejectedRow[],
	locale: Locale = DEFAULT_LOCALE,
): ParsedExpense[] {
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
	const idxParticipants = findColumnIndex(header, ['teilnehmer', 'participants', 'für']); // i18n-ignore import parser column names
	const idxCurrency = findColumnIndex(header, ['währung', 'wahrung', 'currency']); // i18n-ignore import parser column names
	if (idxDate === -1 || idxDesc === -1 || idxAmount === -1 || idxPaidBy === -1) return [];

	const out: ParsedExpense[] = [];
	for (let r = 1; r < rows.length; r += 1) {
		const fields = rows[r]?.fields ?? [];
		const line = rows[r]?.lineNumber ?? r + 1;
		const warnings: string[] = [];
		const descRaw = (fields[idxDesc] ?? '').trim();
		if (!descRaw) continue;
		const date = parseDateIso(fields[idxDate] ?? '', locale);
		if (!date) {
			rejected?.push({ line, reason: 'date_invalid', description: descRaw });
			continue;
		}
		const totalCents = parseAmountToCents(fields[idxAmount] ?? '');
		if (totalCents === null || totalCents <= 0) {
			rejected?.push({ line, reason: 'amount_invalid', description: descRaw });
			continue;
		}
		const paidByName = (fields[idxPaidBy] ?? '').trim();
		if (!paidByName) {
			rejected?.push({ line, reason: 'payer_missing', description: descRaw });
			continue;
		}
		if (idxCurrency !== -1) {
			const currencyRaw = (fields[idxCurrency] ?? 'EUR').trim().toUpperCase();
			if (currencyRaw && currencyRaw !== 'EUR') {
				// A reported row must not also be imported as euros.
				if (rejectForeignCurrencyRow(rejected, line, currencyRaw, descRaw)) continue;
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
