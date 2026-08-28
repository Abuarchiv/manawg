import { describe, expect, it } from 'vitest';
import {
	addMonths,
	buildRecurringAdvance,
	detectProvider,
	formatIntervalLabel,
	getDueRecurringExpenses,
	getRecurringExpenseHref,
	parseRecurringSplits,
	previewNextOccurrences,
	recurringDueDateMatchesExpected,
	recurringSplitsMatchAmount,
	recurringSplitsSum,
	wasRecurringExpenseAlreadyCreated,
} from './recurring-expenses';

describe('recurring expense helpers', () => {
	it('builds encoded WG-scoped links to recurring templates', () => {
		expect(getRecurringExpenseHref('WG/123?x=1', 'recurring-1')).toBe(
			'/wg/WG%2F123%3Fx%3D1/ausgaben?recurring=recurring-1',
		);
		expect(getRecurringExpenseHref('MTE8PZAT', 'recurring 1&edit=true')).toBe(
			'/wg/MTE8PZAT/ausgaben?recurring=recurring%201%26edit%3Dtrue',
		);
	});

	it('returns due templates newest by due date', () => {
		expect(
			getDueRecurringExpenses(
				[
					{
						id: 'later',
						description: 'Strom',
						amountCents: 4200,
						nextDueAt: '2026-06-01T00:00:00.000Z',
					},
					{
						id: 'due',
						description: 'Internet',
						amountCents: 3290,
						nextDueAt: '2026-05-18T00:00:00.000Z',
					},
				],
				new Date('2026-05-18T12:00:00.000Z').getTime(),
			).map((item) => item.id),
		).toEqual(['due']);
	});

	it('ignores recurring templates with invalid due dates', () => {
		expect(
			getDueRecurringExpenses(
				[
					{
						id: 'broken',
						description: 'Internet',
						amountCents: 3290,
						nextDueAt: 'not-a-date',
					},
				],
				new Date('2026-05-18T12:00:00.000Z').getTime(),
			),
		).toEqual([]);
	});

	it('keeps month-end dates valid', () => {
		expect(addMonths(new Date('2026-01-31T12:00:00.000Z'), 1).toISOString()).toBe(
			'2026-02-28T12:00:00.000Z',
		);
	});

	it('advances a recurring template and records the last creation time', () => {
		expect(
			buildRecurringAdvance(
				{
					nextDueAt: '2026-05-31T12:00:00.000Z',
					intervalMonths: 1,
				},
				new Date('2026-05-19T10:00:00.000Z'),
			),
		).toEqual({
			nextDueAt: new Date('2026-06-30T12:00:00.000Z'),
			lastCreatedAt: new Date('2026-05-19T10:00:00.000Z'),
			anchorAt: new Date('2026-05-31T12:00:00.000Z'),
		});
	});

	it('keeps the anchor day across a month-end clamp (no drift)', () => {
		const advance = buildRecurringAdvance({
			nextDueAt: '2026-02-28T12:00:00.000Z',
			intervalMonths: 1,
			anchorAt: '2026-01-31T12:00:00.000Z',
		});
		expect(advance.nextDueAt.toISOString()).toBe('2026-03-31T12:00:00.000Z');
	});

	it('detects when a recurring template was already created for its due window', () => {
		expect(
			wasRecurringExpenseAlreadyCreated({
				nextDueAt: '2026-05-18T00:00:00.000Z',
				lastCreatedAt: '2026-05-18T08:00:00.000Z',
			}),
		).toBe(true);
		expect(
			wasRecurringExpenseAlreadyCreated({
				nextDueAt: '2026-05-18T00:00:00.000Z',
				lastCreatedAt: '2026-05-17T23:59:59.000Z',
			}),
		).toBe(false);
		expect(
			wasRecurringExpenseAlreadyCreated({
				nextDueAt: 'not-a-date',
				lastCreatedAt: '2026-05-18T08:00:00.000Z',
			}),
		).toBe(false);
	});

	it('compares expected recurring due dates by timestamp', () => {
		expect(
			recurringDueDateMatchesExpected('2026-05-18T00:00:00.000Z', '2026-05-18T02:00:00.000+02:00'),
		).toBe(true);
		expect(
			recurringDueDateMatchesExpected('2026-05-19T00:00:00.000Z', '2026-05-18T00:00:00.000Z'),
		).toBe(false);
		expect(recurringDueDateMatchesExpected('broken', '2026-05-18T00:00:00.000Z')).toBe(false);
	});

	it('parses recurring splits defensively', () => {
		expect(
			parseRecurringSplits(
				JSON.stringify([
					{ debtorMemberId: 'member-1', amountCents: 1200 },
					{ debtorMemberId: 123, amountCents: 800 },
					null,
				]),
			),
		).toEqual([{ debtorMemberId: 'member-1', amountCents: 1200 }]);
		expect(parseRecurringSplits('not-json')).toEqual([]);
		expect(parseRecurringSplits('{}')).toEqual([]);
	});

	it('validates recurring split totals against the template amount', () => {
		const splits = [
			{ debtorMemberId: 'member-1', amountCents: 1200 },
			{ debtorMemberId: 'member-2', amountCents: 800 },
		];
		expect(recurringSplitsSum(splits)).toBe(2000);
		expect(recurringSplitsMatchAmount(splits, 2000)).toBe(true);
		expect(recurringSplitsMatchAmount(splits, 2500)).toBe(false);
		expect(recurringSplitsMatchAmount([], 0)).toBe(false);
	});

	it('detects provider keys from common subscription descriptions', () => {
		expect(detectProvider('Netflix Standard HD')).toBe('netflix');
		expect(detectProvider('Spotify Family')).toBe('spotify');
		expect(detectProvider('Disney+')).toBe('disney');
		expect(detectProvider('Stadtwerke Strom Mai')).toBe('strom');
		expect(detectProvider('Vodafone Internet Flat')).toBe('internet');
		expect(detectProvider('Random Abo')).toBeNull();
		expect(detectProvider(null)).toBeNull();
	});

	it('previews the next N occurrences for a recurring template', () => {
		expect(
			previewNextOccurrences({ nextDueAt: '2026-06-01T00:00:00.000Z', intervalMonths: 1 }, 3).map(
				(date) => date.toISOString(),
			),
		).toEqual(['2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z']);
		expect(previewNextOccurrences({ nextDueAt: 'broken', intervalMonths: 1 }, 3)).toEqual([]);
		expect(
			previewNextOccurrences({ nextDueAt: '2026-06-01T00:00:00.000Z', intervalMonths: 1 }, 0),
		).toEqual([]);
	});

	it('formats common interval labels in German', () => {
		expect(formatIntervalLabel(1)).toBe('monatlich');
		expect(formatIntervalLabel(3)).toBe('quartalsweise');
		expect(formatIntervalLabel(6)).toBe('halbjährlich');
		expect(formatIntervalLabel(12)).toBe('jährlich');
		expect(formatIntervalLabel(2)).toBe('alle 2 Monate');
	});
});

describe('addMonths UTC stability', () => {
	it('preserves UTC day across DST boundary (Oct 27 CEST)', () => {
		// Oct 27 2025 02:30 UTC is the DST transition in Europe/Berlin.
		// addMonths must use UTC methods so a Berlin-local clock change
		// does not shift the date by ±1 hour.
		const src = new Date('2025-10-27T02:30:00.000Z');
		const next = addMonths(src, 1);
		expect(next.toISOString()).toBe('2025-11-27T02:30:00.000Z');
	});

	it('clamps Jan 31 + 1 month to Feb 28 in UTC', () => {
		const src = new Date('2026-01-31T12:00:00.000Z');
		const next = addMonths(src, 1);
		expect(next.toISOString()).toBe('2026-02-28T12:00:00.000Z');
	});
});
