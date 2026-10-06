import assert from 'node:assert/strict';
import test from 'node:test';
import { startOfBerlinDay } from '@/core/utils/berlin-day';
import {
	EVENT_REMINDER_BUDGET,
	collectReminderOccurrences,
	processReminderBatches,
	reminderCopyForOccurrence,
	startsInReminderWindow,
} from './event-reminder-dispatch';
import { expandRecurrence } from './events';
import { computeTomorrowUtcWindow } from './server/event-reminder-window';

test('reminders include only occurrences that start tomorrow', () => {
	const from = new Date('2026-09-22T22:00:00.000Z');
	const to = new Date('2026-09-23T21:59:59.999Z');
	const ongoing = {
		id: 'ongoing',
		title: 'Ongoing',
		description: null,
		startsAt: '2026-09-22T00:00:00.000Z',
		endsAt: '2026-09-24T00:00:00.000Z',
		allDay: true,
		location: null,
		recurrence: null,
	};
	const tomorrow = { ...ongoing, id: 'tomorrow', startsAt: '2026-09-23T00:00:00.000Z' };
	const due = collectReminderOccurrences([ongoing, tomorrow], (event) =>
		expandRecurrence(event, from, to).filter((occ) => startsInReminderWindow(occ, from, to)),
	);
	assert.deepEqual(
		due?.map(({ eventId }) => eventId),
		['tomorrow'],
	);
});

test('cron occurrence preflight rejects 10001 before claims and accepts exactly 10000', () => {
	const roots = Array.from({ length: 1000 }, (_, index) => index);
	let claims = 0;
	let sends = 0;
	const exact = collectReminderOccurrences(roots, (root) =>
		Array.from({ length: 10 }, (_, index) => `${root}:${index}`),
	);
	const overflow = collectReminderOccurrences(roots, (root) =>
		Array.from({ length: root === 999 ? 11 : 10 }, (_, index) => `${root}:${index}`),
	);
	if (overflow !== null) {
		claims += overflow.length;
		sends += overflow.length;
	}
	assert.equal(exact?.length, EVENT_REMINDER_BUDGET);
	assert.equal(overflow, null);
	assert.equal(claims, 0);
	assert.equal(sends, 0);
});

test('reminder batches claim only the current batch, limit concurrency, and release failures', async () => {
	let active = 0;
	let peak = 0;
	let claims = 0;
	let firstBatchDone = 0;
	let claimedFutureEarly = false;
	const released: number[] = [];
	const result = await processReminderBatches(
		Array.from({ length: 23 }, (_, index) => index),
		async (index) => {
			claims += 1;
			if (index >= 10 && firstBatchDone < 10) claimedFutureEarly = true;
			return true;
		},
		async (index) => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setImmediate(resolve));
			active -= 1;
			if (index < 10) firstBatchDone += 1;
			if (index === 11) throw new Error('mock failure');
			return { sent: index === 20 ? 0 : 1 };
		},
		async (index) => {
			released.push(index);
		},
	);
	assert.equal(peak, 10);
	assert.equal(active, 0);
	assert.equal(claims, 23);
	assert.equal(claimedFutureEarly, false);
	assert.deepEqual(result, { sent: 21, failed: 1 });
	assert.deepEqual(released, [11, 20]);
});

test('reminder batch releases earlier claims when a later claim fails', async () => {
	const released: number[] = [];
	let sends = 0;
	await assert.rejects(
		processReminderBatches(
			[0, 1, 2],
			async (index) => {
				if (index === 1) throw new Error('claim failed');
				return true;
			},
			async () => {
				sends += 1;
				return { sent: 1 };
			},
			async (index) => {
				released.push(index);
			},
		),
		/claim failed/,
	);
	assert.equal(sends, 0);
	assert.deepEqual(released, [0]);
});

test('member occurrence partial failure retries only the failed member', async () => {
	const items = [
		{ eventId: 'event-1', occurrenceStartsAt: '2026-10-26T18:00:00.000Z', memberId: 'A' },
		{ eventId: 'event-1', occurrenceStartsAt: '2026-10-26T18:00:00.000Z', memberId: 'B' },
	];
	const claims = new Set<string>();
	const attempts = new Map<string, number>();
	const dispatches: string[] = [];
	const run = () =>
		processReminderBatches(
			items,
			async ({ memberId }) => {
				if (claims.has(memberId)) return false;
				claims.add(memberId);
				return true;
			},
			async ({ memberId }) => {
				dispatches.push(memberId);
				const attempt = attempts.get(memberId) ?? 0;
				attempts.set(memberId, attempt + 1);
				return memberId === 'B' && attempt === 0
					? { sent: 1, failures: ['one B device failed'] }
					: { sent: 1, failures: [] };
			},
			async ({ memberId }) => {
				claims.delete(memberId);
			},
		);

	assert.deepEqual(await run(), { sent: 1, failed: 1 });
	assert.deepEqual([...claims], ['A']);
	assert.deepEqual(await run(), { sent: 1, failed: 0 });
	assert.deepEqual(dispatches, ['A', 'B', 'B']);
	assert.deepEqual([...claims], ['A', 'B']);
});

test('today reminder selection keeps current all-day spans and excludes stale events', () => {
	const now = new Date('2026-03-29T10:00:00.000Z');
	const todayStart = startOfBerlinDay(now);
	const { start: tomorrowStart, end: tomorrowEnd } = computeTomorrowUtcWindow(now);
	const occurrence = (startsAt: string, endsAt: string | null, allDay = false) => ({
		startsAt,
		endsAt,
		allDay,
	});
	const classify = (value: ReturnType<typeof occurrence>) =>
		reminderCopyForOccurrence(value, now, todayStart, tomorrowStart, tomorrowEnd);

	assert.equal(
		classify(occurrence('2026-03-29T11:00:00.000Z', '2026-03-29T12:00:00.000Z')),
		'today',
	);
	assert.equal(classify(occurrence('2026-03-29T08:00:00.000Z', '2026-03-29T09:00:00.000Z')), null);
	assert.equal(
		classify(occurrence('2026-03-28T22:00:00.000Z', '2026-03-29T11:00:00.000Z')),
		'today',
	);
	assert.equal(
		classify(occurrence('2026-03-27T23:00:00.000Z', '2026-03-28T23:00:00.000Z', true)),
		'today',
	);
	assert.equal(
		classify(occurrence('2026-03-26T23:00:00.000Z', '2026-03-27T23:00:00.000Z', true)),
		null,
	);
	assert.equal(
		classify(occurrence('2026-03-29T22:30:00.000Z', '2026-03-29T23:30:00.000Z')),
		'tomorrow',
	);
});
