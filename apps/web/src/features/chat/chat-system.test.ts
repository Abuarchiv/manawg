import assert from 'node:assert/strict';
import test from 'node:test';

const { systemAmountText } = await import('./chat-system');
const { formatEuroCents } = await import('@/core/utils/money');

test('the amount of a chat notice follows the reader locale', () => {
	const data = { amountCents: 123450, currency: 'EUR', amount: '1.234,50 €' };
	assert.equal(systemAmountText(data, 'en'), '€1,234.50');
	assert.equal(systemAmountText(data, 'de'), formatEuroCents(123450, 'EUR'));
});

test('older notices keep the stored amount text', () => {
	assert.equal(systemAmountText({ amount: ' 12,50 € ' }, 'en'), '12,50 €');
	assert.equal(systemAmountText({}, 'de'), null);
});
