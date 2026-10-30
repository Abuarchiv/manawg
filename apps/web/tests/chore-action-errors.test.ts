import assert from 'node:assert/strict';
import test from 'node:test';

const { choreActionErrorMessage } = await import('../src/features/chores/chore-errors.ts');

const TAKE_OVER = { key: 'chores.errors.takeOverSubject' } as const;

test('a take-over that lost the version race shows the chore-changed message', () => {
	assert.deepEqual(choreActionErrorMessage(TAKE_OVER, { error: 'chore_changed', status: 409 }), {
		key: 'chores.errors.choreChanged',
	});
});

test('an unknown take-over error falls back to the subject sentence', () => {
	assert.deepEqual(choreActionErrorMessage(TAKE_OVER, { error: 'insert_failed', status: 400 }), {
		key: 'chores.errors.sentence',
		values: { subject: TAKE_OVER },
	});
});
