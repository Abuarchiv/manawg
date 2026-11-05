import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '@/shared/i18n/message';

const { eventSaveError, eventUpdateError, isEventGone } = await import('./event-save-errors');

const subject: Message = { key: 'events.errors.saveSubject' };
const withSubject = (key: string) => ({
	key: 'common.errors.withSubject',
	values: { subject, detail: { key } },
});

test('a missing permission, a changed event and a gone event each get their own hint', () => {
	assert.deepEqual(
		eventSaveError(subject, { status: 403, error: 'forbidden' }),
		withSubject('events.errors.notAllowed'),
	);
	assert.deepEqual(
		eventSaveError(subject, { status: 409, error: 'event_changed' }),
		withSubject('events.errors.eventChanged'),
	);
	assert.deepEqual(
		eventSaveError(subject, { status: 404, error: 'event_not_found' }),
		withSubject('events.errors.gone'),
	);
	for (const error of ['occurrence_changed', 'occurrence_not_found']) {
		assert.deepEqual(eventSaveError(subject, { status: 409, error }), {
			key: 'events.errors.occurrenceChanged',
		});
	}
});

test('a missing WG or another status is not reported as a deleted event', () => {
	for (const res of [
		{ status: 404, error: 'wg_not_found' },
		{ status: 500, error: 'event_not_found' },
	]) {
		assert.notDeepEqual(eventSaveError(subject, res), withSubject('events.errors.gone'));
	}
});

test('an edit conflict says the form stays open on the reloaded event', () => {
	assert.deepEqual(
		eventUpdateError(subject, { status: 409, error: 'event_changed' }),
		withSubject('events.errors.eventChangedEdit'),
	);
	assert.deepEqual(
		eventUpdateError(subject, { status: 403, error: 'forbidden' }),
		withSubject('events.errors.notAllowed'),
	);
});

test('only a 404 event_not_found means someone deleted the event', () => {
	assert.equal(isEventGone({ status: 404, error: 'event_not_found' }), true);
	assert.equal(isEventGone({ status: 404, error: 'wg_not_found' }), false);
	assert.equal(isEventGone({ status: 410, error: 'event_not_found' }), false);
});
