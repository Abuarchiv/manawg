import assert from 'node:assert/strict';
import test from 'node:test';

const { normalizeEventDateTime, serializeWgEvent, toDatetimeLocalValue, validateEventForm } =
	await import('./event-form');

test('the datetime-local value is local wall time with padded fields', () => {
	assert.equal(toDatetimeLocalValue(new Date(2026, 0, 5, 7, 3)), '2026-01-05T07:03');
	assert.equal(toDatetimeLocalValue(new Date(2026, 11, 31, 23, 59)), '2026-12-31T23:59');
});

test('an all-day value is cut to midnight of its day, a timed value stays', () => {
	assert.equal(normalizeEventDateTime('2026-11-05T14:30', true), '2026-11-05T00:00');
	assert.equal(normalizeEventDateTime('2026-11-05', true), '2026-11-05T00:00');
	assert.equal(normalizeEventDateTime('2026-11-05T14:30', false), '2026-11-05T14:30');
	assert.equal(normalizeEventDateTime('2026-11', true), '2026-11');
});

test('the form reports a missing title, then a missing start', () => {
	const result = (title: string, startsAt: string) =>
		validateEventForm({ title, startsAt, endsAt: '' });
	assert.deepEqual(result('  ', ''), {
		ok: false,
		error: { key: 'events.form.errors.titleMissing' },
		field: 'title',
	});
	assert.deepEqual(result('Party', ''), {
		ok: false,
		error: { key: 'events.form.errors.startMissing' },
		field: 'startsAt',
	});
});

test('a timed event is read in local time and may end exactly at its start', () => {
	assert.deepEqual(
		validateEventForm({ title: 'Party', startsAt: '2026-11-05T19:00', endsAt: '2026-11-05T19:00' }),
		{ ok: true, startsAt: new Date(2026, 10, 5, 19), endsAt: new Date(2026, 10, 5, 19) },
	);
	assert.deepEqual(
		validateEventForm({ title: 'Party', startsAt: '2026-11-05T19:00', endsAt: '' }),
		{
			ok: true,
			startsAt: new Date(2026, 10, 5, 19),
			endsAt: null,
		},
	);
	const before = validateEventForm({
		title: 'Party',
		startsAt: '2026-11-05T19:00',
		endsAt: '2026-11-05T18:59',
	});
	assert.equal(before.ok === false && before.field, 'endsAt');
});

test('an all-day event is stored as UTC midnight of the chosen days', () => {
	assert.deepEqual(
		validateEventForm({
			title: 'Urlaub',
			startsAt: '2026-11-05T14:30',
			endsAt: '2026-11-07T08:00',
			allDay: true,
		}),
		{
			ok: true,
			startsAt: new Date('2026-11-05T00:00:00.000Z'),
			endsAt: new Date('2026-11-07T00:00:00.000Z'),
		},
	);
	// Same day with an earlier time is still a valid one-day event.
	const sameDay = validateEventForm({
		title: 'Urlaub',
		startsAt: '2026-11-05T14:30',
		endsAt: '2026-11-05T08:00',
		allDay: true,
	});
	assert.equal(sameDay.ok, true);
});

test('a start or end outside the allowed years is refused on its field', () => {
	const start = validateEventForm({ title: 'Party', startsAt: '0001-01-01T10:00', endsAt: '' });
	assert.equal(start.ok === false && start.error.key, 'events.form.errors.startInvalid');
	const end = validateEventForm({
		title: 'Party',
		startsAt: '2026-11-05T10:00',
		endsAt: '9999-01-01T10:00',
	});
	assert.equal(end.ok === false && end.error.key, 'events.form.errors.endInvalid');
});

test('a stored event goes on the wire with ISO dates and a null end', () => {
	const row = {
		id: 'e1',
		wgId: 'wg-1',
		title: 'Party',
		description: null,
		startsAt: new Date('2026-11-05T18:00:00.000Z'),
		endsAt: new Date('2026-11-05T22:00:00.000Z'),
		allDay: false,
		location: null,
		recurrence: null,
		createdByMemberId: 'm1',
		createdAt: new Date('2026-11-01T10:00:00.000Z'),
		updatedAt: new Date('2026-11-02T10:00:00.000Z'),
	};
	const wire = serializeWgEvent(row as never);
	assert.equal(wire.startsAt, '2026-11-05T18:00:00.000Z');
	assert.equal(wire.endsAt, '2026-11-05T22:00:00.000Z');
	assert.equal(wire.updatedAt, '2026-11-02T10:00:00.000Z');
	assert.equal(serializeWgEvent({ ...row, endsAt: null } as never).endsAt, null);
});
