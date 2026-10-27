import assert from 'node:assert/strict';
import test from 'node:test';

const { dateTimeFormat, intlTag, numberFormat } = await import('./intl');

test('intl tags are de-DE and en-GB', () => {
	assert.equal(intlTag('de'), 'de-DE');
	assert.equal(intlTag('en'), 'en-GB');
});

test('de-DE formats like the existing call sites', () => {
	const euro = { style: 'currency', currency: 'EUR' } as const;
	assert.equal(
		numberFormat('de', euro).format(12.5),
		new Intl.NumberFormat('de-DE', euro).format(12.5),
	);
	assert.equal(numberFormat('de', euro).format(1284.5), '1.284,50 €');
	const date = new Date('2026-03-03T12:00:00Z');
	const options = {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		timeZone: 'Europe/Berlin',
	} as const;
	assert.equal(dateTimeFormat('de', options).format(date), '03.03.2026');
});

test('en-GB puts the euro sign first with a point decimal', () => {
	const euro = { style: 'currency', currency: 'EUR' } as const;
	assert.equal(numberFormat('en', euro).format(12.5), '€12.50');
	assert.equal(numberFormat('en', euro).format(1284.5), '€1,284.50');
});

test('en-GB dates are day-month and 24-hour', () => {
	const date = new Date('2026-03-03T14:05:00Z');
	const options = {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'Europe/Berlin',
	} as const;
	assert.equal(dateTimeFormat('en', options).format(date), '3 March 2026');
	assert.equal(
		dateTimeFormat('en', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(
			date,
		),
		'15:05',
	);
});

test('formatters are memoized per locale and options', () => {
	assert.equal(numberFormat('en', { style: 'percent' }), numberFormat('en', { style: 'percent' }));
	assert.notEqual(
		numberFormat('en', { style: 'percent' }),
		numberFormat('de', { style: 'percent' }),
	);
	assert.equal(dateTimeFormat('de'), dateTimeFormat('de'));
});
