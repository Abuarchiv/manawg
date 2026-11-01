import assert from 'node:assert/strict';
import test from 'node:test';

const {
	inputDateOrToday,
	inputDateToIso,
	msUntilNextLocalDay,
	todayAsPickedDate,
	todayInputValue,
} = await import('../src/core/utils/local-date.ts');
const { berlinDayKey } = await import('../src/core/utils/berlin-day.ts');

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

test('a picked date is the same calendar day on the device, in Berlin and in UTC', () => {
	const originalTz = process.env.TZ;
	try {
		for (const tz of [
			'Pacific/Kiritimati',
			'Pacific/Auckland',
			'Pacific/Honolulu',
			'Pacific/Pago_Pago',
			'America/Los_Angeles',
			'Europe/Berlin',
		]) {
			process.env.TZ = tz;
			for (const day of ['2026-07-01', '2026-10-29', '2026-11-01', '2027-01-31']) {
				const stored = new Date(inputDateToIso(day) ?? '');
				assert.equal(stored.toISOString().slice(0, 10), day, `${tz} ${day} in UTC`);
				assert.equal(berlinDayKey(stored), day, `${tz} ${day} in Berlin`);
				assert.equal(todayInputValue(stored), day, `${tz} ${day} on the device`);
			}
		}
	} finally {
		if (originalTz === undefined) delete process.env.TZ;
		else process.env.TZ = originalTz;
	}
});

test('zones that already agree with Berlin keep local noon', () => {
	const originalTz = process.env.TZ;
	try {
		for (const tz of ['Europe/Berlin', 'America/Los_Angeles']) {
			process.env.TZ = tz;
			assert.equal(inputDateToIso('2026-10-29'), new Date(2026, 9, 29, 12).toISOString());
		}
	} finally {
		if (originalTz === undefined) delete process.env.TZ;
		else process.env.TZ = originalTz;
	}
});

test('today is stored like a picked day, also in UTC+14', () => {
	const originalTz = process.env.TZ;
	try {
		for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/Berlin']) {
			process.env.TZ = tz;
			const morning = new Date(2026, 10, 1, 8, 0);
			const today = todayAsPickedDate(morning);
			assert.equal(berlinDayKey(today), '2026-11-01', `${tz} in Berlin`);
			assert.equal(today.getUTCDate(), 1, `${tz} UTC day for the anchor`);
		}
	} finally {
		if (originalTz === undefined) delete process.env.TZ;
		else process.env.TZ = originalTz;
	}
});

test('a monthly series keeps its day of month in UTC+13', () => {
	const originalTz = process.env.TZ;
	try {
		process.env.TZ = 'Pacific/Auckland';
		const days = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'];
		for (const day of days) {
			assert.equal(new Date(inputDateToIso(day) ?? '').getUTCDate(), Number(day.slice(8)), day);
		}
	} finally {
		if (originalTz === undefined) delete process.env.TZ;
		else process.env.TZ = originalTz;
	}
});
