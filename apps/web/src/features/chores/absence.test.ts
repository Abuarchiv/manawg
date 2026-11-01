import assert from 'node:assert/strict';
import test from 'node:test';
import { instantAtBerlinWallTime } from '@/core/utils/berlin-day';
import { getAbsentMemberIds, isAbsencePeriodValid } from './absence';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

test('an ordered period inside the accepted years is valid', () => {
	assert.equal(isAbsencePeriodValid(day('2026-11-05'), day('2026-12-01')), true);
});

test('a reversed period is invalid', () => {
	assert.equal(isAbsencePeriodValid(day('2026-12-01'), day('2026-11-05')), false);
});

test('a start or end year outside the server range is invalid', () => {
	assert.equal(isAbsencePeriodValid(day('1850-11-05'), day('2026-12-01')), false);
	assert.equal(isAbsencePeriodValid(day('2026-11-05'), day('2300-01-01')), false);
});

test('missing dates are invalid', () => {
	assert.equal(isAbsencePeriodValid(null, day('2026-12-01')), false);
});

test('the end day is judged by the end of its Berlin day, which the server checks', () => {
	const start = instantAtBerlinWallTime('2026-11-05', 0);
	assert.equal(isAbsencePeriodValid(start, instantAtBerlinWallTime('2200-12-31', 0)), true);
	assert.equal(isAbsencePeriodValid(start, instantAtBerlinWallTime('2201-01-01', 0)), false);
});

test('an absence covers whole Berlin days, including the first and the last', () => {
	// 12 Oct 2026 00:00 to 14 Oct 2026 00:00 Berlin (CEST, UTC+2).
	const absences = [
		{
			memberId: 'a',
			startDate: '2026-10-11T22:00:00.000Z',
			endDate: '2026-10-13T22:00:00.000Z',
		},
	];
	const at = (iso: string) => getAbsentMemberIds(absences, Date.parse(iso));
	assert.deepEqual(at('2026-10-11T12:00:00.000Z'), []);
	assert.deepEqual(at('2026-10-11T21:59:00.000Z'), []);
	assert.deepEqual(at('2026-10-11T22:00:00.000Z'), ['a']);
	assert.deepEqual(at('2026-10-12T12:00:00.000Z'), ['a']);
	assert.deepEqual(at('2026-10-14T12:00:00.000Z'), ['a']);
	assert.deepEqual(at('2026-10-14T21:59:00.000Z'), ['a']);
	assert.deepEqual(at('2026-10-14T22:00:00.000Z'), []);
	assert.deepEqual(at('2026-10-15T12:00:00.000Z'), []);
});
