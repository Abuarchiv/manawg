import { describe, expect, it } from 'vitest';
import {
	buildEmptyExportSummary,
	buildExportSummary,
	buildWgExport,
	formatExpenseSplitsForExport,
	getExportSectionHeaders,
	getExportSectionRows,
	isExportSectionKey,
	parseRecurringSplitsForExport,
	toCsv,
} from './export';

describe('buildWgExport', () => {
	it('packages WG data with stable sections', () => {
		const data = buildWgExport({
			wg: { name: 'Test WG', shareCode: 'ABC12345' },
			members: [{ id: 'm1', name: 'Ava' }],
			expenses: [{ id: 'e1', description: 'Miete', amountCents: 50000, paidByName: 'Ava' }],
			recurringExpenses: [{ id: 'r1', description: 'Internet', amountCents: 3290 }],
			shoppingItems: [{ id: 's1', name: 'Milch', status: 'offen' }],
			chores: [{ id: 'c1', title: 'Bad', assignedName: 'Ava' }],
			absences: [{ id: 'ab1', memberName: 'Ava', reason: 'Urlaub' }],
			announcements: [{ id: 'a1', content: 'Hallo', authorName: 'Ava' }],
			auditEvents: [
				{ id: 'au1', eventType: 'expense.created', summary: 'Ava hat Miete eingetragen.' },
			],
		});

		expect(data.wg).toEqual({ name: 'Test WG', shareCode: 'ABC12345' });
		expect(Object.keys(data.sections)).toEqual([
			'members',
			'expenses',
			'recurringExpenses',
			'shoppingItems',
			'chores',
			'absences',
			'announcements',
			'auditEvents',
		]);
	});
});

describe('buildExportSummary', () => {
	it('summarizes available export sections', () => {
		expect(
			buildExportSummary(
				buildWgExport({
					wg: { name: 'Test WG', shareCode: 'ABC12345' },
					members: [{ id: 'm1' }],
					expenses: [{ id: 'e1' }],
					recurringExpenses: [{ id: 'r1' }],
					shoppingItems: [],
					chores: [{ id: 'c1' }, { id: 'c2' }],
					absences: [{ id: 'ab1' }],
					announcements: [],
					auditEvents: [{ id: 'au1' }],
				}),
			),
		).toEqual([
			{ key: 'members', label: 'Mitglieder', count: 1 },
			{ key: 'expenses', label: 'Ausgaben', count: 1 },
			{ key: 'recurringExpenses', label: 'Fixkosten', count: 1 },
			{ key: 'shoppingItems', label: 'Einkauf', count: 0 },
			{ key: 'chores', label: 'Putzplan', count: 2 },
			{ key: 'absences', label: 'Abwesenheiten', count: 1 },
			{ key: 'announcements', label: 'Pinnwand', count: 0 },
			{ key: 'auditEvents', label: 'Audit', count: 1 },
		]);
	});

	it('provides fallback rows for unavailable export summaries', () => {
		expect(buildEmptyExportSummary()).toEqual([
			{ key: 'members', label: 'Mitglieder', count: 0 },
			{ key: 'expenses', label: 'Ausgaben', count: 0 },
			{ key: 'recurringExpenses', label: 'Fixkosten', count: 0 },
			{ key: 'shoppingItems', label: 'Einkauf', count: 0 },
			{ key: 'chores', label: 'Putzplan', count: 0 },
			{ key: 'absences', label: 'Abwesenheiten', count: 0 },
			{ key: 'announcements', label: 'Pinnwand', count: 0 },
			{ key: 'auditEvents', label: 'Audit', count: 0 },
		]);
	});
});

describe('export section helpers', () => {
	it('validates and reads specific export sections for CSV downloads', () => {
		const data = buildWgExport({
			wg: { name: 'Test WG', shareCode: 'ABC12345' },
			members: [{ id: 'm1' }],
			expenses: [{ id: 'e1' }],
			recurringExpenses: [{ id: 'r1' }],
			shoppingItems: [],
			chores: [],
			absences: [],
			announcements: [],
			auditEvents: [{ id: 'au1', summary: 'Audit' }],
		});

		expect(isExportSectionKey('auditEvents')).toBe(true);
		expect(isExportSectionKey('nope')).toBe(false);
		expect(getExportSectionRows(data, 'auditEvents')).toEqual([{ id: 'au1', summary: 'Audit' }]);
	});
});

describe('parseRecurringSplitsForExport', () => {
	it('keeps valid split rows and drops malformed or corrupt values', () => {
		const memberById = new Map([
			['m1', 'Ava'],
			['m2', 'Ben'],
		]);

		expect(
			parseRecurringSplitsForExport(
				JSON.stringify([
					{ debtorMemberId: 'm1', amountCents: 1234 },
					{ debtorMemberId: 'missing', amountCents: 567 },
					{ debtorMemberId: 'm2', amountCents: 'broken' },
				]),
				memberById,
			),
		).toEqual([
			{ debtor: 'Ava', amountCents: 1234 },
			{ debtor: 'missing', amountCents: 567 },
		]);
		expect(parseRecurringSplitsForExport('not-json', memberById)).toEqual([]);
		expect(parseRecurringSplitsForExport('{}', memberById)).toEqual([]);
	});
});

describe('formatExpenseSplitsForExport', () => {
	it('keeps debtor ids, display names, amounts, and settlement timestamps', () => {
		const memberById = new Map([['m1', 'Ava']]);

		expect(
			formatExpenseSplitsForExport(
				[
					{
						debtorMemberId: 'm1',
						amountCents: 1234,
						settledAt: new Date('2026-05-20T10:00:00.000Z'),
					},
					{ debtorMemberId: 'missing', amountCents: 567, settledAt: null },
				],
				memberById,
			),
		).toEqual([
			{
				debtorMemberId: 'm1',
				debtor: 'Ava',
				amountCents: 1234,
				settledAt: '2026-05-20T10:00:00.000Z',
			},
			{ debtorMemberId: 'missing', debtor: 'missing', amountCents: 567, settledAt: null },
		]);
	});
});

describe('toCsv', () => {
	it('keeps headers for empty section exports', () => {
		expect(toCsv([], getExportSectionHeaders('shoppingItems'))).toBe(
			'id,name,quantity,status,createdAt',
		);
	});

	it('includes split data in expense CSV headers', () => {
		expect(toCsv([], getExportSectionHeaders('expenses'))).toBe(
			'id,description,amountCents,currency,paidBy,imageUrl,occurredAt,splits',
		);
	});

	it('uses provided section headers for populated exports', () => {
		expect(
			toCsv(
				[
					{
						createdAt: '2026-05-20T00:00:00.000Z',
						name: 'Milch',
						id: 's1',
						status: 'offen',
						quantity: '1L',
						internalNote: 'nicht exportieren',
					},
				],
				getExportSectionHeaders('shoppingItems'),
			),
		).toBe('id,name,quantity,status,createdAt\ns1,Milch,1L,offen,2026-05-20T00:00:00.000Z');
	});

	it('escapes commas, quotes, and newlines', () => {
		expect(toCsv([{ name: 'Ava, B', note: 'sagt "hi"\njetzt' }])).toBe(
			'name,note\n"Ava, B","sagt ""hi""\njetzt"',
		);
	});

	it('keeps image urls in csv rows for receipts and photos', () => {
		expect(
			toCsv([
				{
					description: 'Miete',
					imageUrl: 'https://cdn.example/receipt.jpg',
				},
			]),
		).toBe('description,imageUrl\nMiete,https://cdn.example/receipt.jpg');
	});

	it('serializes nested values as JSON instead of object placeholders', () => {
		expect(
			toCsv([
				{
					description: 'Internet',
					splits: [{ debtor: 'Ava', amountCents: 1234 }],
				},
			]),
		).toBe('description,splits\nInternet,"[{""debtor"":""Ava"",""amountCents"":1234}]"');
	});

	it('neutralizes spreadsheet formulas in exported user text', () => {
		expect(
			toCsv([
				{
					name: '=IMPORTXML("https://example.test")',
					note: '  +SUM(1,2)',
					amountCents: 3290,
				},
			]),
		).toBe('name,note,amountCents\n"\'=IMPORTXML(""https://example.test"")","\'  +SUM(1,2)",3290');
	});

	it('neutralizes spreadsheet formulas hidden behind byte-order marks', () => {
		expect(
			toCsv([
				{
					name: '\uFEFF=IMPORTXML("https://example.test")',
					note: '\uFEFF  @HYPERLINK("https://example.test")',
				},
			]),
		).toBe(
			'name,note\n"\'\uFEFF=IMPORTXML(""https://example.test"")","\'\uFEFF  @HYPERLINK(""https://example.test"")"',
		);
	});
});
