import { DESCRIPTION_MAX_LENGTH } from './expense-constants';
import { MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from './import-body';
import {
	detectDayFirst,
	findColumnIndex,
	parseAmountToCents,
	parseExportDate,
	readCsvTable,
	rejectForeignCurrencyRow,
	splitProportionally,
} from './import-csv-helpers';
import { type ParsedExpense, type RejectedRow, UnsupportedCurrencyError } from './import-types';

// Tricount's export has one row per entry and one "Impacted to <name>" column per person holding
// that person's share. The column names follow the app language and vary a little between
// versions and between the Excel and CSV exports, so each column accepts a few aliases.
const COLUMN_TITLE = ['title', 'titel', 'description', 'beschreibung', 'titre'];
const COLUMN_AMOUNT = ['amount', 'betrag', 'montant'];
const COLUMN_CURRENCY = ['currency', 'währung', 'wahrung', 'devise']; // i18n-ignore import parser column names
const COLUMN_DATE = ['date & time', 'date and time', 'date', 'datum', 'transaction date'];
const COLUMN_PAID_BY = ['paid by', 'payer', 'bezahlt von', 'paye par'];
const COLUMN_TYPE = ['transaction type', 'type', 'transaktionstyp'];
const SHARE_COLUMN = /^(?:impacted(?: to| for)?|paid for|bezahlt für|share(?: of)?)[\s:]+(.+)$/i; // i18n-ignore import parser column names
// "Money transfer", "Reimbursement" and "Balance" repay a debt instead of buying something.
const TRANSFER_TYPE = /transfer|reimburs|remboursement|balance|settle|payment|überweis|erstattung/i; // i18n-ignore import parser column names
// Income is money the group received; an expense here cannot go backwards.
const INCOME_TYPE = /income|einnahme|revenu|recette/i; // i18n-ignore import parser column names
const MULTIPLE_PAYERS = /[;|]/;

interface TricountColumns {
	title: number;
	amount: number;
	currency: number;
	date: number;
	paidBy: number;
	type: number;
	/** Currency named in the amount header, "Amount (EUR)", for files without a currency column. */
	headerCurrency: string;
	shares: { index: number; name: string }[];
}

function withoutUnit(header: string): string {
	return header.replace(/\s*\([^)]*\)\s*$/, '');
}

function readColumns(header: readonly string[]): TricountColumns | null {
	const plain = header.map(withoutUnit);
	const find = (names: readonly string[]) => findColumnIndex(plain, names);
	const columns = {
		title: find(COLUMN_TITLE),
		amount: find(COLUMN_AMOUNT),
		currency: find(COLUMN_CURRENCY),
		date: find(COLUMN_DATE),
		paidBy: find(COLUMN_PAID_BY),
		type: find(COLUMN_TYPE),
	};
	if (columns.amount === -1 || columns.date === -1 || columns.paidBy === -1) return null;
	const fixed = new Set(Object.values(columns));
	const shares: TricountColumns['shares'] = [];
	for (let i = 0; i < header.length; i += 1) {
		if (fixed.has(i)) continue;
		const name = (header[i] ?? '').trim().match(SHARE_COLUMN)?.[1]?.trim();
		if (name) shares.push({ index: i, name });
	}
	if (shares.length === 0) return null;
	const headerCurrency = (header[columns.amount] ?? '').match(/\(\s*([A-Za-z]{3})\s*\)\s*$/)?.[1];
	return { ...columns, headerCurrency: headerCurrency?.toUpperCase() ?? '', shares };
}

function currencyOf(raw: string): string {
	const value = raw.trim().toUpperCase();
	return value === '€' ? 'EUR' : value;
}

export function parseTricountCsv(csv: string, rejected?: RejectedRow[]): ParsedExpense[] {
	const table = readCsvTable(csv, (fields) => readColumns(fields) !== null);
	if (!table || table.header.length > MAX_IMPORT_COLUMNS) return [];
	const columns = readColumns(table.header);
	if (!columns) return [];
	const { rows } = table;
	const cell = (fields: readonly string[], index: number) =>
		index === -1 ? '' : (fields[index] ?? '').trim();
	const dayFirst = detectDayFirst(rows.map((row) => cell(row.fields, columns.date)));

	const out: ParsedExpense[] = [];
	for (const row of rows) {
		// The routes answer too_many_rows past the limit, so parsing further is wasted work.
		if (out.length > MAX_IMPORT_ROWS || (rejected?.length ?? 0) > MAX_IMPORT_ROWS) break;
		const { fields, lineNumber: line } = row;
		const warnings: string[] = [];
		const paidByName = cell(fields, columns.paidBy);
		const amountRaw = cell(fields, columns.amount);
		const titleRaw = cell(fields, columns.title);
		if (!titleRaw && !paidByName && !amountRaw) continue;

		const sharing = columns.shares
			.map(({ index, name }) => ({
				memberName: name,
				// Euros, as splitProportionally compares them with the total.
				weight: (parseAmountToCents(cell(fields, index)) ?? 0) / 100,
			}))
			.filter((entry) => entry.weight > 0);
		const label = () =>
			(titleRaw || `${paidByName} → ${sharing.map((s) => s.memberName).join(', ')}`)
				.slice(0, DESCRIPTION_MAX_LENGTH)
				.trimEnd();

		const date = parseExportDate(cell(fields, columns.date), dayFirst);
		if (!date) {
			rejected?.push({ line, reason: 'date_invalid', description: label() });
			continue;
		}
		const totalCents = parseAmountToCents(amountRaw);
		if (totalCents === null || totalCents === 0) {
			rejected?.push({ line, reason: 'amount_invalid', description: label() });
			continue;
		}
		const type = cell(fields, columns.type);
		if (totalCents < 0 || INCOME_TYPE.test(type)) {
			rejected?.push({ line, reason: 'income_unsupported', description: label() });
			continue;
		}
		if (!paidByName) {
			rejected?.push({ line, reason: 'payer_missing', description: label() });
			continue;
		}
		if (MULTIPLE_PAYERS.test(paidByName)) {
			rejected?.push({ line, reason: 'multiple_payers', description: label() });
			continue;
		}
		const currency = currencyOf(cell(fields, columns.currency)) || columns.headerCurrency || 'EUR';
		if (currency !== 'EUR') {
			// A reported row must not also be imported as euros.
			if (rejectForeignCurrencyRow(rejected, line, currency, label())) continue;
			throw new UnsupportedCurrencyError(currency);
		}
		const { splits, drifted } = splitProportionally(totalCents, sharing);
		if (splits.length === 0) {
			rejected?.push({ line, reason: 'no_participants', description: label() });
			continue;
		}
		if (drifted) warnings.push('custom_splits_drift_adjusted');
		if (TRANSFER_TYPE.test(type)) warnings.push('payment_row');
		out.push({
			date,
			description: label(),
			amountCents: totalCents,
			currency: 'EUR',
			paidByName,
			splits,
			warnings,
		});
	}
	return out;
}
