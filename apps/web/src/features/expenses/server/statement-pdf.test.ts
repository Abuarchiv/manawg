import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import type { MonthlyStatement } from '../monthly-statement';
import { renderStatementPdf, statementPdfFilename } from './statement-pdf';
import { createSheet } from './statement-pdf-sheet';

function statement(overrides: Partial<MonthlyStatement> = {}): MonthlyStatement {
	return {
		monthKey: '2026-09',
		totalCents: 12345,
		items: [
			{
				id: 'e1',
				occurredAt: '2026-09-03T10:00:00Z',
				description: 'Strom & Gas €',
				payerName: 'Jürgen',
				amountCents: 12345,
			},
		],
		categories: [{ category: 'housing', cents: 12345, share: 100 }],
		members: [
			{ id: 'a', name: 'Jürgen', paidCents: 12345, shareCents: 4115 },
			{ id: 'b', name: 'Zoë', paidCents: 0, shareCents: 4115 },
			{ id: 'c', name: 'Łukasz', paidCents: 0, shareCents: 4115 },
			{ id: 'd', name: '🙂 Mia', paidCents: 0, shareCents: 0 },
		],
		open: [
			{ memberId: 'a', name: 'Jürgen', currency: 'EUR', cents: 8230 },
			{ memberId: 'b', name: 'Zoë', currency: 'EUR', cents: -4115 },
			{ memberId: 'c', name: 'Łukasz', currency: 'USD', cents: -4115 },
		],
		transfers: [
			{ fromId: 'b', toId: 'a', fromName: 'Zoë', toName: 'Jürgen', cents: 4115, currency: 'EUR' },
		],
		settled: false,
		asOf: '2026-10-02T08:00:00Z',
		...overrides,
	};
}

const input = { wgName: 'Kastanienallee 🙂', shareCode: 'KST4821X', locale: 'de' as const };

test('the PDF is a readable document with names outside the font', async () => {
	const bytes = await renderStatementPdf({ ...input, statement: statement() });
	assert.equal(Buffer.from(bytes.slice(0, 5)).toString('latin1'), '%PDF-');
	const doc = await PDFDocument.load(bytes);
	assert.ok(doc.getPageCount() >= 1);
	const [page] = doc.getPages();
	assert.deepEqual(
		[Math.round(page?.getWidth() ?? 0), Math.round(page?.getHeight() ?? 0)],
		[595, 842],
	);
});

test('a statement without expenses or open balances still renders', async () => {
	const bytes = await renderStatementPdf({
		...input,
		locale: 'en',
		statement: statement({ items: [], categories: [], totalCents: 0, open: [], transfers: [] }),
	});
	assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 1);
});

test('a long expense list continues on further pages', async () => {
	const items = Array.from({ length: 80 }, (_, index) => ({
		id: `e${index}`,
		occurredAt: '2026-09-03T10:00:00Z',
		description: `Einkauf ${index} ${'sehr langer Text '.repeat(12)}`,
		payerName: 'Jürgen',
		amountCents: 100,
	}));
	const bytes = await renderStatementPdf({ ...input, statement: statement({ items }) });
	assert.ok((await PDFDocument.load(bytes)).getPageCount() > 1);
});

test('the file name carries the month and the language', () => {
	assert.equal(statementPdfFilename('2026-09', 'de'), 'ManaWG-Abrechnung-2026-09.pdf');
	assert.equal(statementPdfFilename('2026-09', 'en'), 'ManaWG-statement-2026-09.pdf');
});

test('names from Central and Eastern Europe, Turkey, Greece and Cyrillic keep their letters', async () => {
	const { safe } = await createSheet('de');
	for (const name of [
		'Łukasz Wójcik',
		'Ayşe Yılmaz',
		'İbrahim Gök',
		'Ştefan Ţară',
		'Đorđe Øster',
		'Ödön Hűvös',
		'Žaneta Čech',
		'Νίκος',
		'Дмитрий Ёлкин',
		'Олена Ґудзь',
	]) {
		assert.equal(safe(name), name);
	}
});

test('text outside the font falls back to a plain space, the base letter or a question mark, and emoji are dropped', async () => {
	const { safe } = await createSheet('de');
	assert.equal(safe('Zoë'), 'Zoë');
	assert.equal(safe('\u04c2'), '\u0436');
	assert.equal(safe('🙂 Mia'), 'Mia');
	assert.equal(safe('Kastanienallee 🏠 12 👩🏽‍🍳'), 'Kastanienallee 12');
	assert.equal(safe('日本'), '??');
	assert.equal(safe('a\u00a0b\u202fc\td'), 'a b c d');
	assert.equal(safe('A → B'), 'A → B');
});
