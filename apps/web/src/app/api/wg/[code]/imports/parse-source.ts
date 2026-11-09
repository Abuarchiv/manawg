import {
	type ParsedExpense,
	parseSettleUpCsv,
	parseSplidCsv,
	parseSplitwiseCsv,
	parseTricountCsv,
	type RejectedRow,
} from '@/features/expenses/import-parsers';
import { parseOcrText } from '@/features/expenses/ocr';
import type { Locale } from '@/shared/i18n/locale';

/**
 * The one place the import source picks its parser. Preview and commit must read a payload
 * identically, so a rejected row listed in the preview is skipped the same way on commit.
 */
export function parseImportSource(source: string, payload: string, locale: Locale) {
	const rejected: RejectedRow[] = [];
	let expenses: ParsedExpense[];
	if (source === 'splitwise_csv') expenses = parseSplitwiseCsv(payload, rejected, locale);
	else if (source === 'splid_csv') expenses = parseSplidCsv(payload, rejected, locale);
	else if (source === 'tricount_csv') expenses = parseTricountCsv(payload, rejected);
	else if (source === 'settleup_csv') expenses = parseSettleUpCsv(payload, rejected);
	else expenses = parseOcrText(payload).expenses;
	return { expenses, rejected };
}
