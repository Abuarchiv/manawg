import assert from 'node:assert/strict';
import test from 'node:test';
import {
	formatNotificationMessage,
	notificationCategoryForEvent,
	notificationPriorityForEvent,
} from './notifications';

test('event notification times use Europe/Berlin in summer and winter', () => {
	const previousTimezone = process.env.TZ;
	process.env.TZ = 'UTC';
	try {
		const summer = formatNotificationMessage('event.upcoming', {
			wgName: 'WG',
			title: 'Treffen',
			startsAt: '2026-07-01T18:00:00.000Z',
		});
		const winter = formatNotificationMessage('event.created', {
			wgName: 'WG',
			title: 'Treffen',
			startsAt: '2026-01-01T18:00:00.000Z',
		});
		const today = formatNotificationMessage('event.today', {
			wgName: 'WG',
			title: 'Treffen',
			startsAt: '2026-01-01T18:00:00.000Z',
		});
		const allDay = formatNotificationMessage('event.today', {
			wgName: 'WG',
			title: 'Feiertag',
			startsAt: '2026-01-01T23:00:00.000Z',
			allDay: true,
		});
		const ongoing = formatNotificationMessage('event.today', {
			wgName: 'WG',
			title: 'Nachtfahrt',
			startsAt: '2026-01-01T23:00:00.000Z',
			ongoing: true,
		});

		assert.match(summer.body, /01\.07\., 20:00/);
		assert.match(winter.body, /01\.01\., 19:00/);
		assert.equal(today.title, 'Termin heute');
		assert.match(today.body, /^Heute in WG:/);
		assert.match(allDay.body, /ist ganztägig/);
		assert.doesNotMatch(allDay.body, /23:00|00:00/);
		assert.match(ongoing.body, /läuft noch/);
	} finally {
		if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
		else process.env.TZ = previousTimezone;
	}
});

test('all-day event pushes show the Berlin date without a clock time', () => {
	const previousTimezone = process.env.TZ;
	process.env.TZ = 'UTC';
	try {
		// All-day events are stored at Berlin midnight (22:00/23:00 UTC the day before).
		const created = formatNotificationMessage('event.created', {
			wgName: 'WG',
			actorName: 'Alex',
			title: 'Umzug',
			startsAt: '2026-09-30T22:00:00.000Z',
			allDay: true,
		});
		const upcoming = formatNotificationMessage('event.upcoming', {
			wgName: 'WG',
			title: 'Feiertag',
			startsAt: '2026-01-01T23:00:00.000Z',
			allDay: true,
		});

		assert.equal(created.body, 'Alex hat in WG „Umzug“ am 01.10. (ganztägig) eingetragen.');
		assert.equal(upcoming.body, 'Morgen in WG: „Feiertag“ am 02.01. (ganztägig).');
		for (const message of [created, upcoming]) {
			assert.doesNotMatch(message.body, /\d{2}:\d{2}/);
		}
	} finally {
		if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
		else process.env.TZ = previousTimezone;
	}
});

test('chore.due copy follows the Berlin day distance to nextDueAt', (t) => {
	// 2026-09-29 23:30 Berlin (21:30 UTC) — still the 29th on the Berlin wall clock.
	t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-29T21:30:00.000Z') });
	const body = (nextDueAt: string | undefined) =>
		formatNotificationMessage('chore.due', { wgName: 'WG', title: 'Bad putzen', nextDueAt }).body;

	assert.equal(body('2026-09-29T08:00:00.000Z'), 'Bad putzen ist heute in WG fällig.');
	assert.equal(body('2026-09-29T22:30:00.000Z'), 'Bad putzen ist morgen in WG fällig.');
	assert.equal(body('2026-09-28T08:00:00.000Z'), 'Bad putzen ist in WG seit 1 Tag offen.');
	assert.equal(body('2026-09-24T08:00:00.000Z'), 'Bad putzen ist in WG seit 5 Tagen offen.');
	assert.equal(body('2026-10-03T08:00:00.000Z'), 'Bad putzen ist am 03.10. in WG fällig.');
	assert.equal(body(undefined), 'Bad putzen ist heute in WG fällig.');
});

test('chore.due copy names the missing assignee for unassigned chores', (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-29T09:00:00.000Z') });
	assert.equal(
		formatNotificationMessage('chore.due', {
			wgName: 'WG',
			title: 'Bad putzen',
			nextDueAt: '2026-09-29T08:00:00.000Z',
			unassigned: true,
		}).body,
		'Bad putzen ist heute in WG fällig. Niemand ist zuständig.',
	);
});

test('moved and cancelled event pushes name the actor and follow the calendar preference', () => {
	const previousTimezone = process.env.TZ;
	process.env.TZ = 'UTC';
	try {
		const base = {
			wgName: 'WG',
			actorName: 'Alex',
			title: 'Plenum',
			startsAt: '2026-01-01T18:00:00.000Z',
			eventId: 'e1',
		};
		const moved = formatNotificationMessage('event.moved', base);
		const cancelled = formatNotificationMessage('event.cancelled', base);
		const series = formatNotificationMessage('event.moved', { ...base, recurring: true });
		const seriesCancelled = formatNotificationMessage('event.cancelled', {
			...base,
			recurring: true,
		});
		const gone = formatNotificationMessage('event.cancelled', { ...base, eventId: undefined });

		assert.equal(moved.title, 'Termin verschoben');
		assert.equal(moved.body, 'Alex hat „Plenum“ in WG auf den 01.01., 19:00 verschoben.');
		assert.equal(moved.urlPath, '/kalender?highlight=e1');
		assert.equal(cancelled.title, 'Termin abgesagt');
		assert.equal(cancelled.body, 'Alex hat „Plenum“ am 01.01., 19:00 in WG abgesagt.');
		assert.equal(series.body, 'Alex hat die Terminserie „Plenum“ in WG verschoben.');
		assert.equal(seriesCancelled.body, 'Alex hat die Terminserie „Plenum“ in WG abgesagt.');
		assert.equal(gone.urlPath, '/kalender');
		for (const event of ['event.moved', 'event.cancelled'] as const) {
			assert.equal(notificationCategoryForEvent(event), 'events');
			assert.equal(notificationPriorityForEvent(event), 'normal');
		}
	} finally {
		if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
		else process.env.TZ = previousTimezone;
	}
});

test('low-stock push shows German decimals', () => {
	const message = formatNotificationMessage('inventory.low_stock', {
		title: 'Milch',
		quantity: 0.5,
		threshold: 1,
		wgName: 'WG',
	});
	assert.ok(message.body.includes('(0,5 von 1)'));
});

test('a voided cash payment tells the other side that the amount is open again', () => {
	const message = formatNotificationMessage('expense.payment_voided', {
		wgName: 'WG',
		actorName: 'Anna',
		amountCents: 1250,
		currency: 'EUR',
	});
	assert.equal(message.title, 'Barzahlung storniert');
	assert.match(
		message.body,
		/^Anna hat die Barzahlung über 12,50\s€ storniert\. Der Betrag ist wieder offen\.$/,
	);
	assert.equal(notificationCategoryForEvent('expense.payment_voided'), 'expenses');
});
