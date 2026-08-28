import { describe, expect, it } from 'vitest';
import { buildPinnwandPrefill, getPinnwandPrefillHref } from './pinnwand-prefill';

describe('buildPinnwandPrefill', () => {
	it('extracts a short title and optional amount from wall text', () => {
		expect(buildPinnwandPrefill('Internet 32,90 € bitte teilen')).toEqual({
			title: 'Internet bitte teilen',
			amountStr: '32,90',
		});
	});

	it('extracts amounts attached directly to the euro sign', () => {
		expect(buildPinnwandPrefill('Pizza 12€ bitte ausgleichen')).toEqual({
			title: 'Pizza bitte ausgleichen',
			amountStr: '12',
		});
		expect(buildPinnwandPrefill('Streaming 9,99€')).toEqual({
			title: 'Streaming',
			amountStr: '9,99',
		});
		expect(buildPinnwandPrefill('Pizza 12€.')).toEqual({
			title: 'Pizza',
			amountStr: '12',
		});
	});

	it('normalizes German thousand-separated amounts for the expense form', () => {
		expect(buildPinnwandPrefill('Miete 1.234,56 € überweisen')).toEqual({
			title: 'Miete überweisen',
			amountStr: '1234,56',
		});
		expect(buildPinnwandPrefill('Kaution 1.200 €')).toEqual({
			title: 'Kaution',
			amountStr: '1200',
		});
		expect(buildPinnwandPrefill('Ticket 1234.56 €')).toEqual({
			title: 'Ticket',
			amountStr: '1234.56',
		});
	});

	it('builds encoded takeover links from wall prefill data', () => {
		const prefill = { title: 'Internet & Streaming', amountStr: '32,90' };

		expect(getPinnwandPrefillHref('WG/123?x=1', 'shopping', prefill)).toBe(
			'/wg/WG%2F123%3Fx%3D1/einkauf?name=Internet+%26+Streaming',
		);
		expect(getPinnwandPrefillHref('MTE8PZAT', 'shopping', prefill)).toBe(
			'/wg/MTE8PZAT/einkauf?name=Internet+%26+Streaming',
		);
		expect(getPinnwandPrefillHref('MTE8PZAT', 'chore', prefill)).toBe(
			'/wg/MTE8PZAT/putzen?title=Internet+%26+Streaming',
		);
		expect(getPinnwandPrefillHref('MTE8PZAT', 'expense', prefill)).toBe(
			'/wg/MTE8PZAT/ausgaben?desc=Internet+%26+Streaming&amount=32%2C90',
		);
		expect(getPinnwandPrefillHref('MTE8PZAT', 'expense', { ...prefill, amountStr: null })).toBe(
			'/wg/MTE8PZAT/ausgaben?desc=Internet+%26+Streaming',
		);
	});
});
