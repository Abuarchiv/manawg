import assert from 'node:assert/strict';
import test from 'node:test';

const { inputDateOrToday, msUntilNextLocalDay } = await import('../src/core/utils/local-date.ts');

test('an untouched date input follows the day after midnight, a picked one stays', () => {
	const afterMidnight = new Date(2026, 9, 28, 0, 5);
	assert.equal(inputDateOrToday(null, afterMidnight), '2026-10-28');
	assert.equal(inputDateOrToday('2026-10-27', afterMidnight), '2026-10-27');
	// A cleared field stays empty so the "date missing" validation still fires.
	assert.equal(inputDateOrToday('', afterMidnight), '');
});

test('the midnight timer fires just after the next local midnight', () => {
	const evening = new Date(2026, 9, 26, 23, 59, 0);
	assert.equal(msUntilNextLocalDay(evening), 61_000);
	const fired = new Date(evening.getTime() + msUntilNextLocalDay(evening));
	assert.equal(fired.getDate(), 27);
});
