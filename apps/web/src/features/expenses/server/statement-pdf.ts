import 'server-only';
import { serverT } from '@/core/i18n/server-t';
import { formatEuroCents } from '@/core/utils/money';
import { dayMonthOptions, formatDayMonthYear } from '@/core/utils/time';
import { dateTimeFormat } from '@/shared/i18n/intl';
import type { Locale } from '@/shared/i18n/locale';
import type { MonthlyStatement } from '../monthly-statement';
import {
	CONTENT_WIDTH,
	type Column,
	createSheet,
	drawPageNumbers,
	ensure,
	fit,
	heading,
	INK,
	MARGIN,
	MUTED,
	OWES,
	paragraph,
	RULE,
	rule,
	SETTLED,
	type Sheet,
	tableHead,
	text,
} from './statement-pdf-sheet';

export interface StatementPdfInput {
	statement: MonthlyStatement;
	wgName: string;
	shareCode: string;
	locale: Locale;
}

export function statementPdfFilename(monthKey: string, locale: Locale): string {
	return serverT(locale, 'statement')('document.pdfFilename', { month: monthKey });
}

function monthTitle(monthKey: string, locale: Locale): string {
	const [year = 0, month = 1] = monthKey.split('-').map(Number);
	return dateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
		new Date(Date.UTC(year, month - 1, 1)),
	);
}

function periodRange(monthKey: string, locale: Locale): { start: string; end: string } {
	const [year = 0, month = 1] = monthKey.split('-').map(Number);
	const zone = { timeZone: 'UTC' } as const;
	return {
		start: dateTimeFormat(locale, { ...dayMonthOptions(locale), ...zone }).format(
			new Date(Date.UTC(year, month - 1, 1)),
		),
		end: dateTimeFormat(locale, { ...dayMonthOptions(locale, true), ...zone }).format(
			new Date(Date.UTC(year, month, 0)),
		),
	};
}

type DocumentT = ReturnType<typeof serverT<'statement'>>;

function drawHeader(sheet: Sheet, input: StatementPdfInput, t: DocumentT): void {
	const { statement, wgName, shareCode, locale } = input;
	const { monthKey } = statement;
	const number = `MWG-${monthKey.slice(2, 4)}${monthKey.slice(5, 7)}-${shareCode.slice(0, 3).toUpperCase()}`;
	text(sheet, 'ManaWG', MARGIN, { size: 15, bold: true });
	const meta: Array<[string, string]> = [
		[t('document.statementNumber'), number],
		[t('document.period'), t('document.periodRange', periodRange(monthKey, locale))],
	];
	for (const [label, value] of meta) {
		text(sheet, label, MARGIN + CONTENT_WIDTH - 150, { size: 8.5, color: MUTED });
		text(sheet, value, MARGIN + CONTENT_WIDTH, { size: 8.5, right: true });
		sheet.y -= 12;
	}
	sheet.y -= 22;
	text(sheet, fit(sheet, t('document.eyebrow', { wgName }), CONTENT_WIDTH, 9), MARGIN, {
		size: 9,
		color: MUTED,
	});
	sheet.y -= 18;
	text(sheet, monthTitle(monthKey, locale), MARGIN, { size: 26, bold: true });
	sheet.y -= 38;
}

function drawTotals(sheet: Sheet, statement: MonthlyStatement, t: DocumentT): void {
	const money = (cents: number) => formatEuroCents(cents, 'EUR', { locale: sheet.locale });
	const status =
		statement.items.length === 0
			? { label: t('document.statusEmpty'), color: MUTED }
			: statement.settled
				? { label: t('document.statusSettled'), color: SETTLED }
				: { label: t('document.statusOpen'), color: OWES };
	const cells = [
		{ label: t('document.total'), value: money(statement.totalCents), color: INK },
		{ label: t('document.expenses'), value: String(statement.items.length), color: INK },
		{ label: t('document.status'), value: status.label, color: status.color },
	];
	rule(sheet, INK, 1.2);
	sheet.y -= 10;
	cells.forEach(({ label, value, color }, index) => {
		const x = MARGIN + index * 160;
		text(sheet, label, x, { size: 8.5, color: MUTED });
		sheet.y -= 14;
		text(sheet, value, x, { size: 14, bold: true, color });
		sheet.y += 14;
	});
	sheet.y -= 40;
	rule(sheet);
}

function drawMembers(sheet: Sheet, statement: MonthlyStatement, t: DocumentT): void {
	const { locale } = sheet;
	heading(sheet, t('document.balances'));
	const month = monthTitle(statement.monthKey, locale);
	paragraph(
		sheet,
		t('document.balancesHint', { month, date: formatDayMonthYear(statement.asOf, locale) }),
	);
	sheet.y -= 6;
	const columns: Column[] = [
		{ label: t('document.person'), x: MARGIN },
		{ label: t('document.paid'), x: MARGIN + 250, right: true },
		{ label: t('document.share'), x: MARGIN + 335, right: true },
		{ label: t('document.balance'), x: MARGIN + CONTENT_WIDTH, right: true },
	];
	tableHead(sheet, columns);
	for (const member of statement.members) {
		const open = statement.open.filter((row) => row.memberId === member.id);
		const lines = Math.max(1, open.length);
		if (ensure(sheet, lines * 14 + 8)) tableHead(sheet, columns);
		sheet.y -= 4;
		const money = (cents: number) => formatEuroCents(cents, 'EUR', { locale });
		text(sheet, fit(sheet, member.name, 190, 9.5), MARGIN);
		text(sheet, money(member.paidCents), columns[1]?.x ?? 0, { right: true });
		text(sheet, money(member.shareCents), columns[2]?.x ?? 0, { right: true, color: MUTED });
		if (open.length === 0) {
			text(sheet, t('document.balanceSettled'), MARGIN + CONTENT_WIDTH, {
				right: true,
				color: MUTED,
			});
		}
		open.forEach((row, index) => {
			const amount = formatEuroCents(row.cents, row.currency, { signed: true, locale });
			text(sheet, amount, MARGIN + CONTENT_WIDTH, {
				right: true,
				color: row.cents > 0 ? SETTLED : OWES,
			});
			if (index < open.length - 1) sheet.y -= 14;
		});
		sheet.y -= 14;
		rule(sheet);
	}
}

function drawTransfers(sheet: Sheet, statement: MonthlyStatement, t: DocumentT): void {
	if (statement.transfers.length === 0) return;
	heading(sheet, t('document.settlement'));
	paragraph(sheet, t('document.settlementHint', { count: statement.transfers.length }));
	sheet.y -= 4;
	for (const transfer of statement.transfers) {
		ensure(sheet, 22);
		sheet.y -= 4;
		const label = `${sheet.safe(transfer.fromName)} ${t('document.transferTo')} ${sheet.safe(transfer.toName)}`;
		text(sheet, fit(sheet, label, 380, 9.5), MARGIN);
		const amount = formatEuroCents(transfer.cents, transfer.currency ?? 'EUR', {
			locale: sheet.locale,
		});
		text(sheet, amount, MARGIN + CONTENT_WIDTH, { right: true });
		sheet.y -= 14;
		rule(sheet);
	}
}

function drawCategories(sheet: Sheet, statement: MonthlyStatement, t: DocumentT): void {
	if (statement.items.length === 0) return;
	heading(sheet, t('document.categories'));
	for (const entry of statement.categories) {
		ensure(sheet, 22);
		sheet.y -= 4;
		text(sheet, t(`document.category.${entry.category}`), MARGIN);
		const amount = formatEuroCents(entry.cents, 'EUR', { locale: sheet.locale });
		text(sheet, amount, MARGIN + CONTENT_WIDTH - 50, { right: true });
		text(sheet, t('document.categoryShare', { share: entry.share }), MARGIN + CONTENT_WIDTH, {
			right: true,
			color: MUTED,
		});
		sheet.y -= 14;
		rule(sheet);
	}
}

function drawItems(sheet: Sheet, statement: MonthlyStatement, t: DocumentT): void {
	if (statement.items.length === 0) return;
	const { locale } = sheet;
	heading(sheet, t('document.allExpenses'));
	const day = dateTimeFormat(locale, { ...dayMonthOptions(locale), timeZone: 'Europe/Berlin' });
	const columns: Column[] = [
		{ label: t('document.date'), x: MARGIN },
		{ label: t('document.description'), x: MARGIN + 56 },
		{ label: t('document.from'), x: MARGIN + 330 },
		{ label: t('document.amount'), x: MARGIN + CONTENT_WIDTH, right: true },
	];
	tableHead(sheet, columns);
	for (const item of statement.items) {
		if (ensure(sheet, 22)) tableHead(sheet, columns);
		sheet.y -= 4;
		text(sheet, day.format(new Date(item.occurredAt)), MARGIN, { size: 8.5, color: MUTED });
		text(sheet, fit(sheet, item.description, 265, 9), MARGIN + 56, { size: 9 });
		text(sheet, fit(sheet, item.payerName ?? t('document.formerMember'), 100, 9), MARGIN + 330, {
			size: 9,
			color: MUTED,
		});
		const amount = formatEuroCents(item.amountCents, 'EUR', { locale });
		text(sheet, amount, MARGIN + CONTENT_WIDTH, { size: 9, right: true });
		sheet.y -= 14;
		rule(sheet, RULE, 0.4);
	}
	ensure(sheet, 24);
	sheet.y -= 4;
	text(sheet, t('document.sum'), MARGIN, { size: 9.5, bold: true });
	const total = formatEuroCents(statement.totalCents, 'EUR', { locale });
	text(sheet, total, MARGIN + CONTENT_WIDTH, { size: 9.5, right: true });
	sheet.y -= 14;
}

function drawFooter(sheet: Sheet, t: DocumentT): void {
	ensure(sheet, 150);
	sheet.y -= 22;
	rule(sheet);
	sheet.y -= 10;
	for (const key of ['howWeCalculate', 'note'] as const) {
		text(sheet, t(`document.${key}`), MARGIN, { size: 8, color: INK });
		sheet.y -= 13;
		paragraph(sheet, t(`document.${key}Body`), 8.5);
		sheet.y -= 4;
	}
}

/** The statement of one WG and month as an A4 PDF; identical for every recipient. */
export async function renderStatementPdf(input: StatementPdfInput): Promise<Uint8Array> {
	const sheet = await createSheet(input.locale);
	const t = serverT(input.locale, 'statement');
	sheet.doc.setTitle(`ManaWG ${monthTitle(input.statement.monthKey, input.locale)}`);
	sheet.doc.setCreator('ManaWG');
	sheet.doc.setProducer('ManaWG');
	drawHeader(sheet, input, t);
	drawTotals(sheet, input.statement, t);
	drawMembers(sheet, input.statement, t);
	drawTransfers(sheet, input.statement, t);
	drawCategories(sheet, input.statement, t);
	drawItems(sheet, input.statement, t);
	drawFooter(sheet, t);
	drawPageNumbers(sheet);
	return sheet.doc.save();
}
