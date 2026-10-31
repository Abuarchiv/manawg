import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test, { mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith('@/')) {
			const path = resolve(appRoot, 'src', `${specifier.slice(2)}.ts`);
			return nextResolve(pathToFileURL(path).href, context);
		}
		return nextResolve(specifier, context);
	},
});

const { buildChoreFairness, chooseNextAvailableMember, predictNextAssigneeId, predictNextDueAt } =
	await import('../src/features/chores/chore-fairness.ts');
const { computeNextDueAt } = await import('../src/features/chores/chore-recurrence.ts');
const { getAbsentMemberIds } = await import('../src/features/chores/absence.ts');
const { formatShortDateRange } = await import('../src/core/utils/time.ts');
const { buildChorePatchUpdate } = await import('../src/features/chores/chore-patch.ts');

const now = Date.parse('2026-09-23T12:00:00.000Z');

test('fairness counts each assignee-wide overdue total once', () => {
	const fairness = buildChoreFairness({
		members: [
			{ id: 'alice', name: 'Alice' },
			{ id: 'bob', name: 'Bob' },
		],
		chores: [
			{
				assignedMemberId: 'alice',
				openGapCountForAssignee: 3,
				nextDueAt: '2026-09-20T12:00:00.000Z',
			},
			{
				assignedMemberId: 'alice',
				openGapCountForAssignee: 3,
				nextDueAt: '2026-09-21T12:00:00.000Z',
			},
			{
				assignedMemberId: 'alice',
				openGapCountForAssignee: 3,
				nextDueAt: '2026-09-22T12:00:00.000Z',
			},
		],
		now,
	});
	const alice = fairness.rows.find((row) => row.id === 'alice');

	assert.deepEqual(
		alice && {
			assignedCount: alice.assignedCount,
			openGapCount: alice.openGapCount,
			overdueCount: alice.overdueCount,
			score: alice.score,
		},
		{ assignedCount: 3, openGapCount: 3, overdueCount: 3, score: 21 },
	);
});

test('offline chores with zero gaps do not hide another chore gaps for that assignee', () => {
	const fairness = buildChoreFairness({
		members: [{ id: 'alice', name: 'Alice' }],
		chores: [
			{
				assignedMemberId: 'alice',
				openGapCountForAssignee: 0,
				nextDueAt: '2026-09-25T12:00:00.000Z',
			},
			{
				assignedMemberId: 'alice',
				openGapCountForAssignee: 3,
				nextDueAt: '2026-09-20T12:00:00.000Z',
			},
			{
				assignedMemberId: 'alice',
				openGapCountForAssignee: 3,
				nextDueAt: '2026-09-21T12:00:00.000Z',
			},
			{
				assignedMemberId: 'alice',
				openGapCountForAssignee: 3,
				nextDueAt: '2026-09-22T12:00:00.000Z',
			},
		],
		now,
	});

	assert.equal(fairness.rows[0]?.openGapCount, 3);
});

test('score-aware rotation skips the just-completed assignee when another member is available', () => {
	const nextMember = chooseNextAvailableMember({
		members: [
			{ id: 'alice', name: 'Alice' },
			{ id: 'bob', name: 'Bob' },
		],
		currentMemberId: 'alice',
		chores: [
			{
				assignedMemberId: 'alice',
				openGapCountForAssignee: 0,
				nextDueAt: '2026-09-24T12:00:00.000Z',
			},
			{
				assignedMemberId: 'bob',
				openGapCountForAssignee: 0,
				nextDueAt: '2026-09-24T12:00:00.000Z',
			},
			{
				assignedMemberId: 'bob',
				openGapCountForAssignee: 0,
				nextDueAt: '2026-09-25T12:00:00.000Z',
			},
		],
		now,
	});

	assert.equal(nextMember, 'bob');
});

test('explicit monthly due-date changes reset the cadence anchor', () => {
	const changedDate = new Date('2026-03-30T12:00:00.000Z');
	const result = buildChorePatchUpdate(
		{
			intervalDays: 1,
			recurrenceType: 'months',
			nextDueAt: new Date('2026-01-31T12:00:00.000Z'),
		},
		{ nextDueAt: changedDate.toISOString() },
	);

	assert.deepEqual(result, {
		update: { nextDueAt: changedDate, anchorAt: changedDate },
		validCadence: true,
	});
});

test('PATCH validates the interval against the resulting recurrence unit', () => {
	const result = buildChorePatchUpdate(
		{
			intervalDays: 365,
			recurrenceType: 'days',
			nextDueAt: new Date('2026-09-30T12:00:00.000Z'),
		},
		{ recurrenceType: 'months' },
	);

	assert.equal(result.validCadence, false);
});

test('switching from days to months anchors the month cycle at the current due date', () => {
	const currentDueAt = new Date('2026-09-30T12:00:00.000Z');
	const result = buildChorePatchUpdate(
		{ intervalDays: 7, recurrenceType: 'days', nextDueAt: currentDueAt },
		{ recurrenceType: 'months' },
	);

	assert.deepEqual(result, {
		update: { recurrenceType: 'months', anchorAt: currentDueAt },
		validCadence: true,
	});
});

test('absence end date includes the selected Berlin calendar day', () => {
	const absence = [{ memberId: 'alice', startDate: '2026-09-24', endDate: '2026-09-24' }];
	assert.equal(
		getAbsentMemberIds(absence, Date.parse('2026-09-24T18:00:00+02:00')).includes('alice'),
		true,
	);
	assert.equal(
		getAbsentMemberIds(absence, Date.parse('2026-09-25T00:00:00+02:00')).includes('alice'),
		false,
	);
});

test('absence dates use Berlin days across daylight saving and travel', () => {
	const startDate = '2026-03-29T00:00:00+01:00';
	const endDate = '2026-03-29T23:59:59+02:00';
	const absence = [
		{
			memberId: 'alice',
			startDate,
			endDate,
		},
	];
	assert.equal(
		getAbsentMemberIds(absence, Date.parse('2026-03-29T00:00:00+01:00')).includes('alice'),
		true,
	);
	assert.equal(
		getAbsentMemberIds(absence, Date.parse('2026-03-30T00:00:00+02:00')).includes('alice'),
		false,
	);
	assert.equal(formatShortDateRange(startDate, endDate), '29.03.');
});

test('next-assignee prediction uses the month-end anchor like the server', () => {
	mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-02-27T12:00:00.000Z') });
	try {
		const members = [
			{ id: 'A', name: 'A' },
			{ id: 'B', name: 'B' },
			{ id: 'C', name: 'C' },
		];
		const absences = [
			{
				memberId: 'B',
				startDate: '2026-03-29T00:00:00+01:00',
				endDate: '2026-03-31T23:59:59+02:00',
			},
		];
		const chore = {
			nextDueAt: '2026-02-28T11:00:00.000Z',
			intervalDays: 1,
			recurrenceType: 'months' as const,
			assignedMemberId: 'A',
			openGapCountForAssignee: 0,
		};
		const anchorAt = '2026-01-31T11:00:00.000Z';
		const serverDue = computeNextDueAt(
			new Date(chore.nextDueAt),
			1,
			new Date(),
			'months',
			new Date(anchorAt),
		);
		const expected = chooseNextAvailableMember({
			members,
			currentMemberId: 'A',
			absentMemberIds: getAbsentMemberIds(absences, serverDue.getTime()),
			chores: [chore],
		});
		assert.equal(expected, 'C');
		assert.equal(predictNextAssigneeId({ ...chore, anchorAt }, [chore], members, absences), 'C');
		const withoutAnchor = predictNextAssigneeId(chore, [chore], members, absences);
		assert.ok(members.some((member) => member.id === withoutAnchor));
	} finally {
		mock.timers.reset();
	}
});

test('the optimistic next due date keeps the month-end anchor like the complete route', () => {
	mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-02-27T12:00:00.000Z') });
	try {
		const chore = {
			nextDueAt: '2026-02-28T11:00:00.000Z',
			anchorAt: '2026-01-31T11:00:00.000Z',
			intervalDays: 1,
			recurrenceType: 'months' as const,
			assignedMemberId: 'A',
		};
		const serverDue = computeNextDueAt(
			new Date(chore.nextDueAt),
			1,
			new Date(),
			'months',
			new Date(chore.anchorAt),
		);
		assert.equal(serverDue.toISOString().slice(0, 10), '2026-03-31');
		assert.equal(predictNextDueAt(chore)?.getTime(), serverDue.getTime());
		assert.equal(predictNextDueAt({ ...chore, nextDueAt: 'not a date' }), null);
	} finally {
		mock.timers.reset();
	}
});
