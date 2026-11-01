import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChoreOccurrences, type ChoreSummary } from './calendar-page-model';

const chore = (id: string, nextDueAt: string): ChoreSummary => ({
	id,
	title: `Chore ${id}`,
	nextDueAt,
});

test('chore occurrences keep both range ends and are sorted by due time', () => {
	const from = new Date('2026-10-01T00:00:00.000Z');
	const to = new Date('2026-10-31T00:00:00.000Z');
	const occurrences = buildChoreOccurrences(
		[
			chore('after', '2026-10-31T00:00:00.001Z'),
			chore('to', '2026-10-31T00:00:00.000Z'),
			chore('before', '2026-09-30T23:59:59.999Z'),
			chore('from', '2026-10-01T00:00:00.000Z'),
		],
		from,
		to,
	);
	assert.deepEqual(
		occurrences.map((occurrence) => occurrence.choreId),
		['from', 'to'],
	);
});
