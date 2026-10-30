import assert from 'node:assert/strict';
import test from 'node:test';
import { isAbsencePeriodValid } from './absence';

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
