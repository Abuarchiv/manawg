import { describe, expect, it } from 'vitest';

import {
	berlinDayKey,
	endOfBerlinDay,
	nextBerlinDayStart,
	prevBerlinDayStart,
	startOfBerlinDay,
} from './berlin-day';

const MS_PER_HOUR = 60 * 60 * 1000;

// Winter (CET, UTC+1): Berlin midnight = 23:00 UTC of the previous day.
const CET_NOON = new Date('2026-01-15T12:00:00.000Z');
// Summer (CEST, UTC+2): Berlin midnight = 22:00 UTC of the previous day.
const CEST_NOON = new Date('2026-07-19T12:00:00.000Z');
// 2026-03-29: spring-forward day in Berlin (23 hours long).
const DST_SPRING_NOON = new Date('2026-03-29T12:00:00.000Z');
// 2026-10-25: fall-back day in Berlin (25 hours long).
const DST_FALL_NOON = new Date('2026-10-25T12:00:00.000Z');

describe('berlinDayKey', () => {
	it('returns the Berlin calendar date as YYYY-MM-DD', () => {
		expect(berlinDayKey(CET_NOON)).toBe('2026-01-15');
		expect(berlinDayKey(CEST_NOON)).toBe('2026-07-19');
	});

	it('rolls to the next Berlin day before UTC midnight (CET)', () => {
		// 23:30 UTC on Jan 14 = 00:30 Berlin time on Jan 15.
		expect(berlinDayKey(new Date('2026-01-14T23:30:00.000Z'))).toBe('2026-01-15');
	});

	it('rolls to the next Berlin day before UTC midnight (CEST)', () => {
		// 22:30 UTC on Jul 18 = 00:30 Berlin time on Jul 19.
		expect(berlinDayKey(new Date('2026-07-18T22:30:00.000Z'))).toBe('2026-07-19');
	});
});

describe('startOfBerlinDay', () => {
	it('returns 23:00 UTC of the previous day during CET', () => {
		expect(startOfBerlinDay(CET_NOON).toISOString()).toBe('2026-01-14T23:00:00.000Z');
	});

	it('returns 22:00 UTC of the previous day during CEST', () => {
		expect(startOfBerlinDay(CEST_NOON).toISOString()).toBe('2026-07-18T22:00:00.000Z');
	});

	it('stays on the same Berlin day shortly after Berlin midnight', () => {
		// 23:30 UTC Jan 14 is already 00:30 Berlin time on Jan 15.
		const justAfterMidnight = new Date('2026-01-14T23:30:00.000Z');
		expect(startOfBerlinDay(justAfterMidnight).toISOString()).toBe('2026-01-14T23:00:00.000Z');
	});

	it('uses the pre-transition offset on the spring-forward day', () => {
		// Midnight on 2026-03-29 is still CET (clocks jump 02:00 -> 03:00 later).
		expect(startOfBerlinDay(DST_SPRING_NOON).toISOString()).toBe('2026-03-28T23:00:00.000Z');
	});

	it('uses the pre-transition offset on the fall-back day', () => {
		// Midnight on 2026-10-25 is still CEST (clocks fall back 03:00 -> 02:00 later).
		expect(startOfBerlinDay(DST_FALL_NOON).toISOString()).toBe('2026-10-24T22:00:00.000Z');
	});
});

describe('endOfBerlinDay', () => {
	it('returns 1ms before the next Berlin midnight during CET', () => {
		expect(endOfBerlinDay(CET_NOON).toISOString()).toBe('2026-01-15T22:59:59.999Z');
	});

	it('returns 1ms before the next Berlin midnight during CEST', () => {
		expect(endOfBerlinDay(CEST_NOON).toISOString()).toBe('2026-07-19T21:59:59.999Z');
	});

	it('spans only 23 hours on the spring-forward day', () => {
		const start = startOfBerlinDay(DST_SPRING_NOON);
		const end = endOfBerlinDay(DST_SPRING_NOON);
		expect(end.toISOString()).toBe('2026-03-29T21:59:59.999Z');
		expect(end.getTime() - start.getTime()).toBe(23 * MS_PER_HOUR - 1);
	});

	it('spans 25 hours on the fall-back day', () => {
		const start = startOfBerlinDay(DST_FALL_NOON);
		const end = endOfBerlinDay(DST_FALL_NOON);
		expect(end.toISOString()).toBe('2026-10-25T22:59:59.999Z');
		expect(end.getTime() - start.getTime()).toBe(25 * MS_PER_HOUR - 1);
	});
});

describe('nextBerlinDayStart / prevBerlinDayStart', () => {
	it('steps forward across the spring-forward day without skipping or repeating', () => {
		let day = startOfBerlinDay(new Date('2026-03-27T12:00:00.000Z'));
		const keys: string[] = [];
		for (let i = 0; i < 5; i++) {
			keys.push(berlinDayKey(day));
			day = nextBerlinDayStart(day);
		}
		expect(keys).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
	});

	it('steps forward across the fall-back day without skipping or repeating', () => {
		let day = startOfBerlinDay(new Date('2026-10-23T12:00:00.000Z'));
		const keys: string[] = [];
		for (let i = 0; i < 5; i++) {
			keys.push(berlinDayKey(day));
			day = nextBerlinDayStart(day);
		}
		expect(keys).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
	});

	it('steps backward across both DST transitions', () => {
		const afterSpring = startOfBerlinDay(new Date('2026-03-30T12:00:00.000Z'));
		expect(berlinDayKey(prevBerlinDayStart(afterSpring))).toBe('2026-03-29');

		const afterFall = startOfBerlinDay(new Date('2026-10-26T12:00:00.000Z'));
		expect(berlinDayKey(prevBerlinDayStart(afterFall))).toBe('2026-10-25');
	});

	it('is inverse to prevBerlinDayStart', () => {
		const day = startOfBerlinDay(CEST_NOON);
		expect(prevBerlinDayStart(nextBerlinDayStart(day)).getTime()).toBe(day.getTime());
	});
});
