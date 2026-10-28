/**
 * Mapping key for a payer the source does not name (an OCR line without a payer); the UI shows
 * `common.unknownPerson`. A control character, so no CSV or OCR name can equal it (`parseCsv`
 * strips it, the OCR payer pattern allows letters only).
 */
export const UNKNOWN_NAME = '\u001F';

export interface ParsedSplit {
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

/** A CSV data row the parser could not turn into an expense; `line` is the 1-based file line. */
export interface RejectedRow {
	line: number;
	reason:
		| 'date_invalid'
		| 'amount_invalid'
		| 'no_participants'
		| 'payer_missing'
		| 'multiple_payers'
		| 'currency_unsupported';
	/** Row description, plus the offending currency for `currency_unsupported`. */
	description: string;
}

export type ImportSource = 'splitwise_csv' | 'splid_csv' | 'ocr_screenshot' | 'manual';

export class UnsupportedCurrencyError extends Error {
	readonly currency: string;
	constructor(currency: string) {
		super('Only EUR imports are supported');
		this.name = 'UnsupportedCurrencyError';
		this.currency = currency;
	}
}
