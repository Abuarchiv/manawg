import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildChoreFairness,
	chooseNextAvailableMember,
	computeOpenGapsByMember,
	predictNextAssigneeId,
} from './chore-fairness';

const NOW = Date.parse('2026-10-31T10:00:00.000Z');
const dayOffset = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
const anna = { id: 'a', name: 'Anna' };
const ben = { id: 'b', name: 'Ben' };
const cem = { id: 'c', name: 'Cem' };
const members = [anna, ben, cem];

function chore(assignedMemberId: string | null, dueInDays: number, openGaps = 0) {
	return {
		assignedMemberId,
		nextDueAt: dayOffset(dueInDays),
		openGapCountForAssignee: openGaps,
	};
}

test('open gaps count only overdue chores per assignee', () => {
	const gaps = computeOpenGapsByMember(
		[chore('a', -3), chore('a', -5), chore('a', 4), chore('b', 2), chore(null, -9)],
		NOW,
	);
	assert.deepEqual([...gaps], [['a', 2]]);
});

test('open gaps are empty when nothing is overdue', () => {
	assert.equal(computeOpenGapsByMember([chore('a', 1), chore('b', 6)], NOW).size, 0);
});

test('a chore due right now is not an open gap', () => {
	assert.equal(computeOpenGapsByMember([chore('a', 0)], NOW).size, 0);
});

test('the suggested assignee is the member with the lowest score', () => {
	const fairness = buildChoreFairness({
		members,
		chores: [chore('a', 3), chore('a', 4), chore('b', 3)],
		now: NOW,
	});
	assert.deepEqual(
		fairness.rows.map((row) => row.score),
		[4, 2, 0],
	);
	assert.equal(fairness.suggestedAssignee?.id, 'c');
});

test('equal scores fall back to the name, not the member order', () => {
	const fairness = buildChoreFairness({ members: [cem, ben, anna], chores: [], now: NOW });
	assert.equal(fairness.suggestedAssignee?.name, 'Anna');
});

test('the suggested assignee skips absent members and is null when all are absent', () => {
	const skipped = buildChoreFairness({ members, chores: [], absentMemberIds: ['a'], now: NOW });
	assert.equal(skipped.suggestedAssignee?.id, 'b');
	assert.equal(skipped.rows.find((row) => row.id === 'a')?.available, false);
	const nobody = buildChoreFairness({
		members,
		chores: [],
		absentMemberIds: ['a', 'b', 'c'],
		now: NOW,
	});
	assert.equal(nobody.suggestedAssignee, null);
});

test('the next member is the least loaded one who is not the current owner', () => {
	const chores = [chore('a', 3), chore('a', 4), chore('b', 3)];
	assert.equal(chooseNextAvailableMember({ members, currentMemberId: 'a', chores, now: NOW }), 'c');
	// The least loaded member is the current owner: the next-lowest takes over.
	assert.equal(chooseNextAvailableMember({ members, currentMemberId: 'c', chores, now: NOW }), 'b');
});

test('the next member skips absent members when chores exist', () => {
	const chores = [chore('a', 3), chore('a', 4), chore('b', 3)];
	assert.equal(
		chooseNextAvailableMember({
			members,
			currentMemberId: 'a',
			chores,
			absentMemberIds: ['c'],
			now: NOW,
		}),
		'b',
	);
});

test('equal scores rotate to the next member after the current owner and wrap around', () => {
	const even = [chore('a', 3), chore('b', 3), chore('c', 3)];
	assert.equal(
		chooseNextAvailableMember({ members, currentMemberId: 'a', chores: even, now: NOW }),
		'b',
	);
	assert.equal(
		chooseNextAvailableMember({ members, currentMemberId: 'c', chores: even, now: NOW }),
		'a',
	);
});

test('the rotation never lands on an absent member', () => {
	const even = [chore('a', 3), chore('b', 3), chore('c', 3)];
	assert.equal(
		chooseNextAvailableMember({
			members,
			currentMemberId: 'a',
			chores: even,
			absentMemberIds: ['b'],
			now: NOW,
		}),
		'c',
	);
});

test('nobody is chosen when everyone is absent', () => {
	const chores = [chore('a', 3)];
	assert.equal(
		chooseNextAvailableMember({
			members,
			currentMemberId: 'a',
			chores,
			absentMemberIds: ['a', 'b', 'c'],
			now: NOW,
		}),
		null,
	);
	assert.equal(
		chooseNextAvailableMember({
			members,
			currentMemberId: 'a',
			absentMemberIds: ['a', 'b', 'c'],
		}),
		null,
	);
	assert.equal(chooseNextAvailableMember({ members: [], currentMemberId: null }), null);
});

test('without chores the rotation goes round-robin, skips absent members and wraps', () => {
	assert.equal(chooseNextAvailableMember({ members, currentMemberId: 'a' }), 'b');
	assert.equal(
		chooseNextAvailableMember({ members, currentMemberId: 'a', absentMemberIds: ['b'] }),
		'c',
	);
	assert.equal(
		chooseNextAvailableMember({ members, currentMemberId: 'c', absentMemberIds: ['a'] }),
		'b',
	);
	assert.equal(chooseNextAvailableMember({ members, currentMemberId: null }), 'a');
});

test('a one-person WG keeps the chore with its only member', () => {
	assert.equal(
		chooseNextAvailableMember({
			members: [anna],
			currentMemberId: 'a',
			chores: [chore('a', 3)],
			now: NOW,
		}),
		'a',
	);
	assert.equal(chooseNextAvailableMember({ members: [anna], currentMemberId: 'a' }), 'a');
});

test('a tie between two candidates rotates to the one after the current owner', () => {
	// Ben holds the only chore; Anna and Cem tie at zero once Ben is the owner.
	const chores = [chore('b', 3)];
	assert.equal(chooseNextAvailableMember({ members, currentMemberId: 'a', chores, now: NOW }), 'c');
	assert.equal(chooseNextAvailableMember({ members, currentMemberId: 'b', chores, now: NOW }), 'c');
	assert.equal(chooseNextAvailableMember({ members, currentMemberId: 'c', chores, now: NOW }), 'a');
});

test('the predicted next assignee is never the current owner', () => {
	const farFuture = '2099-01-10T10:00:00.000Z';
	const chores = [
		{ assignedMemberId: 'a', nextDueAt: farFuture, openGapCountForAssignee: 0 },
		{ assignedMemberId: 'a', nextDueAt: farFuture, openGapCountForAssignee: 0 },
		{ assignedMemberId: 'b', nextDueAt: farFuture, openGapCountForAssignee: 0 },
		{ assignedMemberId: 'c', nextDueAt: farFuture, openGapCountForAssignee: 0 },
		{ assignedMemberId: 'c', nextDueAt: farFuture, openGapCountForAssignee: 0 },
	];
	// Ben is the least loaded, but the chore he owns moves on to someone else.
	const next = predictNextAssigneeId(
		{ nextDueAt: farFuture, intervalDays: 7, recurrenceType: 'days', assignedMemberId: 'b' },
		chores,
		members,
		[],
	);
	assert.equal(next, 'c');
});
