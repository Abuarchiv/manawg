import assert from 'node:assert/strict';
import test from 'node:test';

const { formatCentsInput, formatDecimal, formatEuroInput, parseEuroAmount } = await import(
	'./amount'
);

const EN_CASES: [string, number | null][] = [
	['12.50', 12.5],
	['12,50', 12.5],
	['12.5', 12.5],
	['12,5', 12.5],
	['12', 12],
	['12.', 12],
	['.5', 0.5],
	[',75', 0.75],
	['€12.50', 12.5],
	['12.50 EUR', 12.5],
	['1 234.50', 1234.5],
	['1,234.50', 1234.5],
	['1.234,50', 1234.5],
	['1,234,567.89', 1234567.89],
	// A three-digit tail is grouping in English, valid only with a comma.
	['1,234', 1234],
	['1,234,567', 1234567],
	['1.234', null],
	['1.234.567', null],
	['1234.567', null],
	['1,23,456', null],
	['1,234,56', null],
	['1.5.5', null],
	['12.345', null],
	['', null],
	['.', null],
	['abc', null],
	['-5', null],
	['1 2', null],
	['12 3', null],
	['9'.repeat(400), null],
];

for (const [input, expected] of EN_CASES) {
	test(`parseEuroAmount en ${JSON.stringify(input)}`, () => {
		assert.equal(parseEuroAmount(input, 'en'), expected);
	});
}

test('parseEuroAmount keeps the German reading of three-digit tails', () => {
	assert.equal(parseEuroAmount('1.234'), 1234);
	assert.equal(parseEuroAmount('1.234', 'de'), 1234);
	assert.equal(parseEuroAmount('1,234'), null);
	assert.equal(parseEuroAmount('1,234,50'), null);
	assert.equal(parseEuroAmount('12,50'), 12.5);
});

test('amount formatters switch separators by locale and default to German', () => {
	assert.equal(formatEuroInput(12.5), '12,50');
	assert.equal(formatEuroInput(12.5, 'en'), '12.50');
	assert.equal(formatCentsInput(1250, 'en'), '12.50');
	assert.equal(formatCentsInput(5), '0,05');
	assert.equal(formatDecimal(1.5), '1,5');
	assert.equal(formatDecimal(1.5, 'en'), '1.5');
	assert.equal(formatDecimal(2, 'en'), '2');
});

test('parseEuroAmount rejects a thousands group that starts with zero', () => {
	assert.equal(parseEuroAmount('0,001', 'en'), null);
	assert.equal(parseEuroAmount('007,500', 'en'), null);
	assert.equal(parseEuroAmount('0.500', 'de'), null);
	assert.equal(parseEuroAmount('0.001'), null);
	assert.equal(parseEuroAmount('1,234', 'en'), 1234);
	assert.equal(parseEuroAmount('1.234,56'), 1234.56);
});
