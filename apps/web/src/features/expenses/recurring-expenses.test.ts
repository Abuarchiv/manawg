import assert from 'node:assert/strict';
import test from 'node:test';

const {
	buildRecurringAdvance,
	canBookRecurringTemplate,
	canManageRecurringTemplate,
	countMissedOccurrences,
	getDueRecurringExpenses,
	intervalLabelMessage,
	parseRecurringSplits,
	previewNextOccurrences,
	wasRecurringExpenseAlreadyCreated,
} = await import('./recurring-expenses');

test('the preview keeps month-end templates on their anchor day', () => {
	// Booked on 28 Feb after starting on the 31st: without the anchor the cadence drifts to 28.
	const preview = previewNextOccurrences(
		{
			nextDueAt: '2027-02-28T12:00:00.000Z',
			intervalMonths: 1,
			anchorAt: '2027-01-31T12:00:00.000Z',
		},
		3,
	);
	assert.deepEqual(
		preview.map((date) => date.toISOString().slice(0, 10)),
		['2027-02-28', '2027-03-31', '2027-04-30'],
	);
	const drifting = previewNextOccurrences(
		{ nextDueAt: '2027-02-28T12:00:00.000Z', intervalMonths: 1 },
		2,
	);
	assert.equal(drifting[1]?.toISOString().slice(0, 10), '2027-03-28');
});

test('missed bookings are counted per interval up to the catch-up cap', () => {
	const now = new Date('2026-10-15T12:00:00.000Z');
	assert.equal(countMissedOccurrences('2026-10-20T12:00:00.000Z', 1, now), 0);
	assert.equal(countMissedOccurrences('2026-10-15T09:00:00.000Z', 1, now), 1);
	assert.equal(countMissedOccurrences('2026-08-01T12:00:00.000Z', 1, now), 3);
	assert.equal(countMissedOccurrences('2026-01-01T12:00:00.000Z', 12, now), 1);
	assert.equal(countMissedOccurrences('2020-01-01T12:00:00.000Z', 1, now), 13);
	assert.equal(countMissedOccurrences('nonsense', 1, now), 0);
});

test('only the creator or an admin manages a template, and booking needs a share', () => {
	assert.equal(canManageRecurringTemplate({ createdByMemberId: 'a' }, 'a', false), true);
	assert.equal(canManageRecurringTemplate({ createdByMemberId: 'a' }, 'b', false), false);
	assert.equal(canManageRecurringTemplate({ createdByMemberId: 'a' }, 'b', true), true);
	assert.equal(canManageRecurringTemplate({}, 'b', false), true);

	const template = { paidByMemberId: 'a', splits: [{ debtorMemberId: 'a', amountCents: 500 }] };
	assert.equal(canBookRecurringTemplate(template, 'a'), true);
	assert.equal(canBookRecurringTemplate(template, 'b'), false);
});

test('interval labels name the common cadences and fall back to a month count', () => {
	assert.deepEqual(intervalLabelMessage(1), { key: 'expenses-recurring.interval.monthly' });
	assert.deepEqual(intervalLabelMessage(3), { key: 'expenses-recurring.interval.quarterly' });
	assert.deepEqual(intervalLabelMessage(6), { key: 'expenses-recurring.interval.halfYearly' });
	assert.deepEqual(intervalLabelMessage(12), { key: 'expenses-recurring.interval.yearly' });
	assert.deepEqual(intervalLabelMessage(2), {
		key: 'expenses-recurring.interval.everyMonths',
		values: { count: 2 },
	});
	assert.deepEqual(intervalLabelMessage(0), { key: 'expenses-recurring.interval.monthly' });
});

test('a recurring booking on 28 Feb moves to 31 Mar for a template anchored on the 31st', () => {
	const advance = buildRecurringAdvance({
		nextDueAt: '2026-02-28T12:00:00.000Z',
		intervalMonths: 1,
		anchorAt: '2026-01-31T12:00:00.000Z',
	});
	assert.equal(advance.nextDueAt.toISOString(), '2026-03-31T12:00:00.000Z');
	assert.equal(advance.anchorAt.toISOString(), '2026-01-31T12:00:00.000Z');
});

test('a template due exactly now is due, and due templates come oldest first', () => {
	const now = Date.parse('2026-03-01T12:00:00.000Z');
	const item = (id: string, nextDueAt: string) => ({
		id,
		description: id,
		amountCents: 1,
		currency: 'EUR',
		nextDueAt,
	});
	const due = getDueRecurringExpenses(
		[
			item('b', '2026-03-01T12:00:00.000Z'),
			item('a', '2026-02-01T12:00:00.000Z'),
			item('c', '2026-03-02T12:00:00.000Z'),
		],
		now,
	);
	assert.deepEqual(
		due.map((entry) => entry.id),
		['a', 'b'],
	);
});

test('the catch-up count includes an occurrence due exactly now and follows the anchor day', () => {
	const now = new Date('2026-03-31T12:00:00.000Z');
	assert.equal(countMissedOccurrences('2026-01-31T12:00:00.000Z', 1, now), 3);
	// Due 28 Feb, anchored on the 31st: the next one is 31 Mar, which is still ahead on 30 Mar.
	assert.equal(
		countMissedOccurrences(
			'2026-02-28T12:00:00.000Z',
			1,
			new Date('2026-03-30T00:00:00.000Z'),
			'2026-01-31T12:00:00.000Z',
		),
		1,
	);
});

test('splits JSON drops entries whose amount is not a number', () => {
	assert.deepEqual(
		parseRecurringSplits(
			'[{"debtorMemberId":"a","amountCents":"5"},{"debtorMemberId":"b","amountCents":5}]',
		),
		[{ debtorMemberId: 'b', amountCents: 5 }],
	);
});

test('the preview treats an interval below 1 as monthly', () => {
	const preview = previewNextOccurrences(
		{ nextDueAt: '2026-01-15T12:00:00.000Z', intervalMonths: 0 },
		3,
	);
	assert.deepEqual(
		preview.map((date) => date.toISOString().slice(0, 10)),
		['2026-01-15', '2026-02-15', '2026-03-15'],
	);
});

test('a booking created exactly at the due instant counts as already created', () => {
	const at = '2026-03-01T12:00:00.000Z';
	assert.equal(wasRecurringExpenseAlreadyCreated({ nextDueAt: at, lastCreatedAt: at }), true);
	assert.equal(
		wasRecurringExpenseAlreadyCreated({
			nextDueAt: at,
			lastCreatedAt: '2026-03-01T11:59:59.999Z',
		}),
		false,
	);
});
