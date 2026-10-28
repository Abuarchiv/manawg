import assert from 'node:assert/strict';
import test from 'node:test';

const { parseOcrText } = await import('./ocr');
const { UNKNOWN_NAME, describeParsedExpenseWarning } = await import('./import-parsers');

test('an OCR line without a payer uses the language-neutral unknown name', () => {
	const [expense] = parseOcrText('05.03.26 Pizza 12,50', '2026-09-27T00:00:00.000Z').expenses;
	assert.equal(expense?.paidByName, UNKNOWN_NAME);
	assert.equal(expense?.splits[0]?.memberName, UNKNOWN_NAME);
});

test('ignored CSV columns are quoted and joined into one message', () => {
	const message = describeParsedExpenseWarning('unknown_columns_ignored:Foo|Bar');
	assert.equal(message.key, 'expenses-import.warnings.unknownColumns');
	assert.deepEqual(message.values, {
		count: 2,
		columns: {
			key: 'expenses-import.warnings.list',
			values: {
				head: { key: 'expenses-import.warnings.quoted', values: { name: 'Foo' } },
				tail: { key: 'expenses-import.warnings.quoted', values: { name: 'Bar' } },
			},
		},
	});
});

test('CSV fields cannot carry the unknown name', async () => {
	const { parseCsv } = await import('./import-csv-helpers');
	assert.deepEqual(parseCsv(`a,${UNKNOWN_NAME}b\n`, ',')[0]?.fields, ['a', 'b']);
});
