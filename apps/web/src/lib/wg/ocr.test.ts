import { describe, expect, it, vi } from 'vitest';
import { type OcrRunner, parseOcrText, runOcrOnImage } from './ocr';

describe('parseOcrText', () => {
	it('extracts amount and description from a simple line', () => {
		const text = 'Bezahlt von Lisa\nPizza Hawaii 12,50 €\nBier 4,00';
		const { expenses } = parseOcrText(text, '2026-04-01T00:00:00Z');
		expect(expenses).toHaveLength(2);
		const pizza = expenses[0];
		const bier = expenses[1];
		if (!pizza || !bier) throw new Error('expected rows');
		expect(pizza.amountCents).toBe(1250);
		expect(pizza.description).toBe('Pizza Hawaii');
		expect(pizza.paidByName).toBe('Lisa');
		expect(bier.amountCents).toBe(400);
		expect(bier.paidByName).toBe('Lisa');
	});

	it('uses default payer "Unbekannt" when no payer line precedes', () => {
		const { expenses } = parseOcrText('Eis 3,00');
		expect(expenses).toHaveLength(1);
		const first = expenses[0];
		if (!first) throw new Error('expected row');
		expect(first.paidByName).toBe('Unbekannt');
	});

	it('updates context date when a date line is encountered', () => {
		const { expenses } = parseOcrText('01.04.2026\nKaffee 2,50 €');
		const first = expenses[0];
		if (!first) throw new Error('expected row');
		expect(first.date.startsWith('2026-04-01')).toBe(true);
	});

	it('skips lines without a parseable amount', () => {
		const { expenses } = parseOcrText('Header\nSeparator ---\nFooter notes');
		expect(expenses).toEqual([]);
	});

	it('returns rawText alongside parsed expenses', () => {
		const { rawText } = parseOcrText('Test 1,00');
		expect(rawText).toBe('Test 1,00');
	});

	it('tags each expense with ocr_heuristic warning', () => {
		const { expenses } = parseOcrText('Lunch 8,00');
		const first = expenses[0];
		if (!first) throw new Error('expected row');
		expect(first.warnings).toContain('ocr_heuristic');
	});
});

describe('runOcrOnImage', () => {
	it('delegates to a provided runner when supplied', async () => {
		const runner: OcrRunner = {
			recognize: vi.fn(async () => 'Pizza 9,99'),
		};
		const blob = new Blob(['x'], { type: 'image/png' });
		const result = await runOcrOnImage(blob, runner);
		expect(result).toBe('Pizza 9,99');
		expect(runner.recognize).toHaveBeenCalledWith(blob);
	});
});
