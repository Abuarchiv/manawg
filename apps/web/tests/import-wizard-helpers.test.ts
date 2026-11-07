import assert from 'node:assert/strict';
import test from 'node:test';

const {
	SKIP_NAME,
	decodeCsv,
	mergeMemberMapping,
	namesInPreview,
	payloadKey,
	rowsWithSkippedNames,
} = await import('../src/features/expenses/components/import/import-wizard-types.ts');

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

test('decodeCsv reads the UTF-16 files Settle Up writes, with and without a byte order mark', () => {
	const utf16 = (text: string, bom: boolean) => {
		const units = new Uint16Array((bom ? 1 : 0) + text.length);
		if (bom) units[0] = 0xfeff;
		for (let i = 0; i < text.length; i += 1) units[(bom ? 1 : 0) + i] = text.charCodeAt(i);
		return units.buffer;
	};
	assert.equal(decodeCsv(utf16('Who paid,Amount\nAnna,5', true)), 'Who paid,Amount\nAnna,5');
	assert.equal(decodeCsv(utf16('Who paid,Amount\nAnna,5', false)), 'Who paid,Amount\nAnna,5');
});

test('payloadKey sends screenshots as OCR text', () => {
	assert.equal(payloadKey('splid_csv'), 'splid_csv');
	assert.equal(payloadKey('tricount_csv'), 'tricount_csv');
	assert.equal(payloadKey('settleup_csv'), 'settleup_csv');
	assert.equal(payloadKey('ocr_screenshot'), 'ocr_text');
});

test('rowsWithSkippedNames skips every row naming a left-out person as payer or debtor', () => {
	const preview = {
		parsed: [
			{ paidByName: 'Anna', splits: [{ memberName: 'Anna' }, { memberName: 'Ben' }] },
			{ paidByName: 'Ben', splits: [{ memberName: 'Anna' }] },
			{ paidByName: 'Anna', splits: [{ memberName: 'Cem' }] },
		],
	};
	assert.deepEqual(
		rowsWithSkippedNames(preview as never, { Anna: 'm1', Ben: SKIP_NAME, Cem: 'm3' }),
		[0, 1],
	);
	assert.deepEqual(rowsWithSkippedNames(null, { Ben: SKIP_NAME }), []);
});
