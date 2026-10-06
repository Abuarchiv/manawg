import assert from 'node:assert/strict';
import test from 'node:test';

const { decodeCsv, mergeMemberMapping, namesInPreview, payloadKey } = await import(
	'../src/features/expenses/components/import/import-wizard-types.ts'
);

test('mergeMemberMapping keeps own choices for names that are still present', () => {
	assert.deepEqual(
		mergeMemberMapping({ Anna: 'm1', Ben: null, Cem: 'm3' }, { Anna: 'm9', Ben: null, Old: 'm4' }),
		{ Anna: 'm9', Ben: null, Cem: 'm3' },
	);
});

test('namesInPreview lists payers and split members once', () => {
	const preview = {
		parsed: [
			{ paidByName: 'Anna', splits: [{ memberName: 'Anna' }, { memberName: 'Ben' }] },
			{ paidByName: 'Ben', splits: [{ memberName: '' }, { memberName: 'Cem' }] },
		],
	} as unknown as Parameters<typeof namesInPreview>[0];
	assert.deepEqual(namesInPreview(preview), ['Anna', 'Ben', 'Cem']);
	assert.deepEqual(namesInPreview(null), []);
});

test('decodeCsv falls back to Windows-1252 for non-UTF-8 exports', () => {
	assert.equal(decodeCsv(new TextEncoder().encode('Brötchen').buffer), 'Brötchen');
	assert.equal(decodeCsv(new Uint8Array([0x42, 0x72, 0xf6, 0x74]).buffer), 'Bröt');
});

test('payloadKey sends screenshots as OCR text', () => {
	assert.equal(payloadKey('splid_csv'), 'splid_csv');
	assert.equal(payloadKey('ocr_screenshot'), 'ocr_text');
});
