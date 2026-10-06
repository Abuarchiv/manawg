import assert from 'node:assert/strict';
import test from 'node:test';

const { countOwnDueChores } = await import('../src/components/wg/own-due-chores.ts');
const { getChoreStatus } = await import('../src/features/chores/chore-status.ts');

const ME = 'member-me';
const NOW = Date.parse('2026-03-29T00:30:00.000Z'); // 01:30 Berlin on the DST switch day

test('countOwnDueChores agrees with the chore status due/overdue states', () => {
	const offsetsHours = [-72, -25, -24, -2, -1, 0, 1, 20, 22, 23, 24, 25, 48, 24 * 7];
	for (const hours of offsetsHours) {
		const nextDueAt = new Date(NOW + hours * 3_600_000).toISOString();
		const expected = ['due', 'overdue'].includes(getChoreStatus(nextDueAt, NOW).state) ? 1 : 0;
		assert.equal(
			countOwnDueChores([{ assignedMemberId: ME, nextDueAt }], ME, NOW),
			expected,
			`offset ${hours}h (${nextDueAt})`,
		);
	}
});

test('countOwnDueChores counts only the member and skips unreadable dates', () => {
	const due = new Date(NOW - 3_600_000).toISOString();
	assert.equal(
		countOwnDueChores(
			[
				{ assignedMemberId: ME, nextDueAt: due },
				{ assignedMemberId: 'someone-else', nextDueAt: due },
				{ assignedMemberId: null, nextDueAt: due },
				{ assignedMemberId: ME, nextDueAt: 'not a date' },
			],
			ME,
			NOW,
		),
		1,
	);
});
