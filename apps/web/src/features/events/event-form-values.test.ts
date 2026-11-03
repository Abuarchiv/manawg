import assert from 'node:assert/strict';
import test from 'node:test';

const { eventFormValues, rebaseEventForm } = await import('./event-form-values');

const base = {
	title: 'WG-Meeting',
	description: '',
	startsAt: '2026-10-02T12:00',
	endsAt: '2026-10-02T13:00',
	allDay: false,
	location: 'Küche',
	recurrence: '',
};

test('a field the user left alone takes the newer value', () => {
	const latest = { ...base, location: 'Balkon' };
	assert.deepEqual(rebaseEventForm(base, latest, base), latest);
});

test('a field the user changed keeps the typed value', () => {
	const latest = { ...base, title: 'Meeting', location: 'Balkon' };
	const current = { ...base, title: 'WG-Abend' };
	assert.deepEqual(rebaseEventForm(base, latest, current), {
		...base,
		title: 'WG-Abend',
		location: 'Balkon',
	});
});

test('a typed value that equals the newer one stays', () => {
	const latest = { ...base, location: 'Balkon' };
	const current = { ...base, location: 'Balkon' };
	assert.deepEqual(rebaseEventForm(base, latest, current), latest);
});

test('a changed all-day flag is kept together with the other typed fields', () => {
	const latest = { ...base, description: 'Mit Pizza' };
	const current = { ...base, allDay: true, startsAt: '2026-10-02T00:00' };
	assert.deepEqual(rebaseEventForm(base, latest, current), {
		...latest,
		allDay: true,
		startsAt: '2026-10-02T00:00',
	});
});

test('form values of an all-day event use its calendar date and empty strings for null', () => {
	const values = eventFormValues(
		{
			title: 'Urlaub',
			description: null,
			startsAt: '2026-10-02T00:00:00.000Z',
			endsAt: null,
			allDay: true,
			location: null,
		},
		null,
	);
	assert.deepEqual(values, {
		title: 'Urlaub',
		description: '',
		startsAt: '2026-10-02T00:00',
		endsAt: '',
		allDay: true,
		location: '',
		recurrence: '',
	});
});
