import assert from 'node:assert/strict';
import test from 'node:test';

const {
	CHORE_COMPLETION_COPY,
	choreCompletionFeedback,
	completionRequestKey,
	submitChoreCompletion,
} = await import('../src/features/chores/chore-completion.ts');

const chore = { title: 'Bad putzen' };
const names = (id: string | null) =>
	id === 'anna'
		? { name: 'Anna', isSelf: false }
		: id === 'me'
			? { name: 'Mia', isSelf: true }
			: undefined;

test('completionRequestKey is stable per occurrence', () => {
	const occurrence = { id: 'c1', nextDueAt: '2026-10-06T10:00:00.000Z' };
	assert.equal(completionRequestKey(occurrence), completionRequestKey({ ...occurrence }));
	assert.notEqual(
		completionRequestKey(occurrence),
		completionRequestKey({ ...occurrence, nextDueAt: '2026-10-13T10:00:00.000Z' }),
	);
});

test('a confirmed completion names the next date and assignee', () => {
	const feedback = choreCompletionFeedback(
		{
			kind: 'completed',
			next: { id: 'c1', nextDueAt: '2026-10-13T10:00:00.000Z', assignedMemberId: 'anna' },
		},
		chore,
		names,
	);
	assert.equal(feedback.tone, 'success');
	assert.deepEqual(feedback.message, {
		key: 'chores.completion.doneNext',
		values: { title: 'Bad putzen', date: '13.10.', assignee: 'other', name: 'Anna' },
	});
	assert.equal(feedback.done, true);
	assert.equal(feedback.reload, true);
});

test('a completion marks the own member as self and others by name', () => {
	const next = (assignedMemberId: string) => ({
		kind: 'completed' as const,
		next: { id: 'c1', nextDueAt: '2026-10-13T10:00:00.000Z', assignedMemberId },
	});
	assert.deepEqual(choreCompletionFeedback(next('me'), chore, names).message, {
		key: 'chores.completion.doneNext',
		values: { title: 'Bad putzen', date: '13.10.', assignee: 'self', name: 'Mia' },
	});
	assert.equal(
		choreCompletionFeedback(next('anna'), chore, names).message.values?.assignee,
		'other',
	);
	assert.equal(
		choreCompletionFeedback(next('nobody'), chore, names).message.key,
		'chores.completion.doneUnassigned',
	);
});

test('the date follows the requested locale', () => {
	const completed = {
		kind: 'completed' as const,
		next: { id: 'c1', nextDueAt: '2026-10-13T10:00:00.000Z', assignedMemberId: 'anna' },
	};
	assert.equal(
		choreCompletionFeedback(completed, chore, names, 'en').message.values?.date,
		'13 Oct',
	);
});

test('the flag, not the name, decides how the next assignee is addressed', () => {
	const next = { id: 'c1', nextDueAt: '2026-10-13T10:00:00.000Z', assignedMemberId: 'x' };
	const assignee = (isSelf: boolean) =>
		choreCompletionFeedback({ kind: 'completed', next }, chore, () => ({ name: 'du', isSelf }))
			.message.values?.assignee;
	assert.equal(assignee(false), 'other');
	assert.equal(assignee(true), 'self');
});

test('an unconfirmed completion still says it is done', () => {
	const feedback = choreCompletionFeedback({ kind: 'completed', next: null }, chore, names);
	assert.equal(feedback.message.key, 'chores.completion.doneUnconfirmed');
});

test('retryable failures keep the confirm step open', () => {
	for (const kind of [
		'failed',
		'insert_failed',
		'queue_blocked',
		'key_unavailable',
		'read_only',
		'session_expired',
	] as const) {
		const feedback = choreCompletionFeedback({ kind }, chore, names);
		assert.equal(feedback.tone, 'error', kind);
		assert.equal(feedback.done, false, kind);
	}
	assert.equal(
		choreCompletionFeedback({ kind: 'failed' }, chore, names).message,
		CHORE_COMPLETION_COPY.failed,
	);
});

test('a moved occurrence ends the confirm step and reloads the plan', () => {
	const feedback = choreCompletionFeedback({ kind: 'occurrence_changed' }, chore, names);
	assert.deepEqual(feedback, {
		tone: 'error',
		message: CHORE_COMPLETION_COPY.occurrenceChanged,
		toast: null,
		done: true,
		reload: true,
	});
});

test('an offline completion is a notice and needs no reload', () => {
	const feedback = choreCompletionFeedback({ kind: 'queued' }, chore, names);
	assert.equal(feedback.tone, 'notice');
	assert.equal(feedback.message, CHORE_COMPLETION_COPY.queued);
	assert.equal(feedback.reload, false);
});

test('maintenance and expired sessions are not reported as a generic failure', async () => {
	const realFetch = globalThis.fetch;
	const ctx = { wgId: 'wg', shareCode: 'ABC', memberId: 'm1', keys: new Map<string, string>() };
	const occurrence = {
		id: 'c1',
		title: 'Bad',
		nextDueAt: '2026-10-06T10:00:00.000Z',
		assignedMemberId: 'm1',
	};
	try {
		for (const [status, error, kind] of [
			[503, 'migration_read_only', 'read_only'],
			[401, 'auth_required', 'session_expired'],
		] as const) {
			globalThis.fetch = (async () =>
				new Response(JSON.stringify({ error }), {
					status,
					headers: { 'content-type': 'application/json' },
				})) as typeof fetch;
			assert.deepEqual(await submitChoreCompletion(ctx, occurrence), { kind });
		}
	} finally {
		globalThis.fetch = realFetch;
	}
});
