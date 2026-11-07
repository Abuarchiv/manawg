import { DESCRIPTION_MAX_LENGTH } from './expense-constants';
import { MAX_IMPORT_ROWS } from './import-body';
import {
	detectDayFirst,
	findColumnIndex,
	parseAmountToCents,
	parseDecimal,
	parseExportDate,
	readCsvTable,
	rejectForeignCurrencyRow,
	splitProportionally,
} from './import-csv-helpers';
import { type ParsedExpense, type RejectedRow, UnsupportedCurrencyError } from './import-types';

// Settle Up exports one row per entry: "Who paid", "Amount", "Currency", "For whom" (names joined
// by ";"), "Split amounts" (one value per name, joined by ";"), "Purpose", "Category",
// "Date & time", "Timezone", "Exchange rate", "Converted amount", "Type", "Receipt". The web export
// is UTF-16 encoded; the wizard decodes that before the text gets here.
const COLUMN_PAID_BY = ['who paid', 'paid by', 'payer'];
const COLUMN_AMOUNT = ['amount'];
const COLUMN_CURRENCY = ['currency'];
const COLUMN_FOR_WHOM = ['for whom'];
const COLUMN_SPLIT = ['split amounts', 'split'];
const COLUMN_PURPOSE = ['purpose', 'description', 'title'];
const COLUMN_DATE = ['date & time', 'date and time', 'date'];
const COLUMN_TYPE = ['type'];
const LIST_SEPARATOR = ';';

interface SettleUpColumns {
	paidBy: number;
	amount: number;
	currency: number;
	forWhom: number;
	split: number;
	purpose: number;
	date: number;
	type: number;
}

function readColumns(header: readonly string[]): SettleUpColumns | null {
	const find = (names: readonly string[]) => findColumnIndex(header, names);
	const columns = {
		paidBy: find(COLUMN_PAID_BY),
		amount: find(COLUMN_AMOUNT),
		currency: find(COLUMN_CURRENCY),
		forWhom: find(COLUMN_FOR_WHOM),
		split: find(COLUMN_SPLIT),
		purpose: find(COLUMN_PURPOSE),
		date: find(COLUMN_DATE),
		type: find(COLUMN_TYPE),
	};
	const required = [columns.paidBy, columns.amount, columns.forWhom, columns.date];
	return required.includes(-1) ? null : columns;
}

function splitList(raw: string): string[] {
	return raw
		.split(LIST_SEPARATOR)
		.map((item) => item.trim())
		.filter(Boolean);
}

export function parseSettleUpCsv(csv: string, rejected?: RejectedRow[]): ParsedExpense[] {
	const table = readCsvTable(csv, (fields) => readColumns(fields) !== null);
	const columns = table && readColumns(table.header);
	if (!table || !columns) return [];
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
		const names = splitList(cell(fields, columns.forWhom));
		const purpose = cell(fields, columns.purpose);
		if (!purpose && !paidByName && !amountRaw) continue;
		// Transfers and quick entries often have no purpose; the people involved say enough.
		const description = (purpose || `${paidByName} → ${names.join(', ')}`)
			.slice(0, DESCRIPTION_MAX_LENGTH)
			.trimEnd();

		const date = parseExportDate(cell(fields, columns.date), dayFirst);
		if (!date) {
			rejected?.push({ line, reason: 'date_invalid', description });
			continue;
		}
		if (!paidByName) {
			rejected?.push({ line, reason: 'payer_missing', description });
			continue;
		}
		if (paidByName.includes(LIST_SEPARATOR)) {
			rejected?.push({ line, reason: 'multiple_payers', description });
			continue;
		}
		const totalCents = parseAmountToCents(amountRaw);
		if (totalCents === null || totalCents <= 0) {
			rejected?.push({ line, reason: 'amount_invalid', description });
			continue;
		}
		const currency = cell(fields, columns.currency).toUpperCase() || 'EUR';
		if (currency !== 'EUR') {
			// A reported row must not also be imported as euros.
			if (rejectForeignCurrencyRow(rejected, line, currency, description)) continue;
			throw new UnsupportedCurrencyError(currency);
		}
		if (names.length === 0) {
			rejected?.push({ line, reason: 'no_participants', description });
			continue;
		}

		// The split column holds one amount per name (or, in older exports, a ratio). Without a
		// matching list every name takes an equal share.
		const splitRaw = cell(fields, columns.split);
		const values = splitList(splitRaw).map(parseDecimal);
		const listed = values.length === names.length && values.every((v) => v !== null && v >= 0);
		if (splitRaw && !listed) warnings.push('custom_splits_discarded');
		const { splits, drifted } = splitProportionally(
			totalCents,
			mergeDuplicateNames(names, listed ? values : names.map(() => 1)),
		);
		if (splits.length === 0) {
			rejected?.push({ line, reason: 'no_participants', description });
			continue;
		}
		if (listed && drifted) warnings.push('custom_splits_drift_adjusted');
		if (/transfer/i.test(cell(fields, columns.type))) warnings.push('payment_row');
		out.push({
			date,
			description,
			amountCents: totalCents,
			currency: 'EUR',
			paidByName,
			splits,
			warnings,
		});
	}
	return out;
}

/** A name listed twice shares one entry, so the member is mapped and shown once. */
function mergeDuplicateNames(
	names: readonly string[],
	values: readonly (number | null)[],
): { memberName: string; weight: number }[] {
	const merged = new Map<string, number>();
	names.forEach((name, i) => {
		merged.set(name, (merged.get(name) ?? 0) + (values[i] ?? 0));
	});
	return Array.from(merged, ([memberName, weight]) => ({ memberName, weight }));
}
