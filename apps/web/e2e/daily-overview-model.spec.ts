import { expect, test } from '@playwright/test';
import {
	getBerlinWeekWindow,
	getForYouItems,
	getWeekAgenda,
} from '../src/core/reads/dashboard-insights';
import type { EventInput, EventOccurrence } from '../src/features/events/events';
import { expandRecurrence } from '../src/features/events/events';
import { buildSettlementSummary, simplifyDebts } from '../src/features/expenses/debt-reduction';

const NOW = Date.parse('2026-09-05T22:30:00.000Z');

function overview(overrides: Record<string, unknown> = {}) {
	return {
		shareCode: 'WG/1',
		currentMemberId: 'member-me',
		openShoppingCount: 2,
		openShoppingTop: ['Milch'],
		dueChores: [],
		myOpenAnnouncements: [],
		dueRecurringExpenses: [],
		absentMembers: [],
		now: NOW,
		...overrides,
	};
}

function event(
	partial: Pick<EventOccurrence, 'eventId' | 'title' | 'startsAt'> & Partial<EventOccurrence>,
): EventOccurrence {
	return {
		description: null,
		endsAt: null,
		allDay: false,
		location: null,
		recurring: false,
		occurrenceIndex: 0,
		...partial,
	};
}

test('separates own chores and labels shared shopping and recurring costs', () => {
	const items = getForYouItems(
		overview({
			dueChores: [
				{
					id: 'mine',
					title: 'Bad',
					nextDueAt: '2026-09-06T09:00:00+02:00',
					overdue: false,
					assignedMemberId: 'member-me',
					assignedMemberName: 'Abu',
				},
				{
					id: 'theirs',
					title: 'Flur',
					nextDueAt: '2026-09-06T10:00:00+02:00',
					overdue: false,
					assignedMemberId: 'member-other',
					assignedMemberName: 'Mina',
				},
			],
			dueRecurringExpenses: [
				{ id: 'internet', description: 'Internet', amountCents: 3000, currency: 'EUR' },
			],
		}),
	);

	expect(items.some((item) => item.entityId === 'mine')).toBe(true);
	expect(items.some((item) => item.entityId === 'theirs')).toBe(false);
	expect(items.find((item) => item.kind === 'shopping')?.detail).toContain('WG');
	expect(items.find((item) => item.kind === 'recurring')?.detail).toContain('WG');
});

test('keeps personal settlements distinct by counterparty and currency', () => {
	const balances = [
		{ memberId: 'member-me', memberName: 'Abu', color: null, balanceCents: -1000, currency: 'EUR' },
		{ memberId: 'anna', memberName: 'Anna', color: null, balanceCents: 600, currency: 'EUR' },
		{ memberId: 'ben', memberName: 'Ben', color: null, balanceCents: 400, currency: 'EUR' },
		{ memberId: 'member-me', memberName: 'Abu', color: null, balanceCents: 300, currency: 'CHF' },
		{ memberId: 'anna', memberName: 'Anna', color: null, balanceCents: -300, currency: 'CHF' },
	];
	const settlements = getForYouItems(overview({ openShoppingCount: 0, balances })).filter(
		(item) => item.kind === 'debt',
	);
	const expected = simplifyDebts(
		balances.map(({ balanceCents, ...balance }) => ({ ...balance, cents: balanceCents })),
	).filter((debt) => debt.fromId === 'member-me' || debt.toId === 'member-me');

	expect(settlements).toHaveLength(3);
	expect(settlements.map((item) => item.entityId)).toEqual([
		'settlement:member-me:anna:EUR',
		'settlement:member-me:ben:EUR',
		'settlement:anna:member-me:CHF',
	]);
	const actualByIdentity = settlements
		.map((item) => [item.entityId, item.title, item.amountCents, item.currency])
		.sort(([left], [right]) => String(left).localeCompare(String(right)));
	const expectedByIdentity = expected
		.map((debt) => [
			`settlement:${debt.fromId}:${debt.toId}:${debt.currency ?? 'EUR'}`,
			debt.fromId === 'member-me' ? `An ${debt.toName}` : `Von ${debt.fromName}`,
			debt.fromId === 'member-me' ? -debt.cents : debt.cents,
			debt.currency,
		])
		.sort(([left], [right]) => String(left).localeCompare(String(right)));
	expect(actualByIdentity).toEqual(expectedByIdentity);
});

test('keeps settlement partners stable when tied balances and members are reordered', () => {
	const balances = [
		{ memberId: 'debtor-a', memberName: 'Abu', color: null, cents: -500, currency: 'EUR' },
		{ memberId: 'creditor-b', memberName: 'Dana', color: null, cents: 500, currency: 'EUR' },
		{ memberId: 'debtor-b', memberName: 'Bea', color: null, cents: -500, currency: 'EUR' },
		{ memberId: 'creditor-a', memberName: 'Clara', color: null, cents: 500, currency: 'EUR' },
	];
	const reorderedBalances = [balances[0], balances[2], balances[3], balances[1]];
	const expenses = [
		{
			paidByMemberId: 'creditor-a',
			splits: [
				{ debtorMemberId: 'debtor-a', amountCents: 250, settledAt: null },
				{ debtorMemberId: 'debtor-b', amountCents: 250, settledAt: null },
				{ debtorMemberId: 'creditor-b', amountCents: 250, settledAt: null },
			],
		},
		{
			paidByMemberId: 'creditor-b',
			splits: [
				{ debtorMemberId: 'debtor-a', amountCents: 250, settledAt: null },
				{ debtorMemberId: 'debtor-b', amountCents: 250, settledAt: null },
				{ debtorMemberId: 'creditor-a', amountCents: 250, settledAt: null },
			],
		},
	];
	const members = [
		{ id: 'debtor-a', name: 'Abu', color: null },
		{ id: 'creditor-b', name: 'Dana', color: null },
		{ id: 'debtor-b', name: 'Bea', color: null },
		{ id: 'creditor-a', name: 'Clara', color: null },
	];
	const reorderedMembers = [members[0], members[2], members[3], members[1]];
	const expectedTransfers = [
		{
			fromId: 'debtor-a',
			fromName: 'Abu',
			toId: 'creditor-a',
			toName: 'Clara',
			cents: 500,
			currency: 'EUR',
		},
		{
			fromId: 'debtor-b',
			fromName: 'Bea',
			toId: 'creditor-b',
			toName: 'Dana',
			cents: 500,
			currency: 'EUR',
		},
	];
	const simplify = (rows: typeof balances) =>
		simplifyDebts(rows).map(({ fromId, fromName, toId, toName, cents, currency }) => ({
			fromId,
			fromName,
			toId,
			toName,
			cents,
			currency,
		}));
	const summary = (roster: typeof members) => buildSettlementSummary(expenses, roster).simplified;
	const expectedHomeRows = [['settlement:debtor-a:creditor-a:EUR', 'An Clara', -500, 'EUR']];
	const homeRows = (rows: typeof balances) =>
		getForYouItems(
			overview({
				currentMemberId: 'debtor-a',
				balances: rows.map(({ cents, ...balance }) => ({ ...balance, balanceCents: cents })),
			}),
		)
			.filter((item) => item.kind === 'debt')
			.map((item) => [item.entityId, item.title, item.amountCents, item.currency]);

	expect(simplify(balances)).toEqual(expectedTransfers);
	expect(simplify(reorderedBalances)).toEqual(expectedTransfers);
	expect(summary(members)).toEqual(expectedTransfers);
	expect(summary(reorderedMembers)).toEqual(expectedTransfers);
	expect(homeRows(balances)).toEqual(expectedHomeRows);
	expect(homeRows(reorderedBalances)).toEqual(expectedHomeRows);
});

test('builds the Berlin week agenda with separate overdue context and no own duplicates', () => {
	const window = getBerlinWeekWindow(NOW);
	const rawWeekly: EventInput = {
		id: 'weekly',
		title: 'Sonntagsbrunch',
		description: null,
		startsAt: '2026-08-30T16:00:00.000Z',
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=WEEKLY',
	};
	const events = [
		event({
			eventId: 'all-day',
			title: 'WG-Putzaktion',
			startsAt: '2026-09-06T00:00:00.000Z',
			allDay: true,
		}),
		event({
			eventId: 'ongoing',
			title: 'Wochenendgäste',
			startsAt: '2026-09-05T20:00:00.000Z',
			endsAt: '2026-09-06T08:00:00.000Z',
		}),
		...expandRecurrence(rawWeekly, window.from, window.to),
		event({
			eventId: 'next-week',
			title: 'Nicht diese Woche',
			startsAt: '2026-09-07T08:00:00.000Z',
		}),
	];
	const agenda = getWeekAgenda({
		shareCode: 'WG/1',
		currentMemberId: 'member-me',
		now: NOW,
		events,
		dueChores: [
			{
				id: 'overdue-other',
				title: 'Flur',
				nextDueAt: '2026-09-05T10:00:00+02:00',
				overdue: true,
				assignedMemberId: 'member-other',
				assignedMemberName: 'Mina',
			},
			{
				id: 'own-today',
				title: 'Bad',
				nextDueAt: '2026-09-06T09:00:00+02:00',
				overdue: false,
				assignedMemberId: 'member-me',
				assignedMemberName: 'Abu',
			},
			{
				id: 'sunday-other',
				title: 'Küche',
				nextDueAt: '2026-09-06T18:00:00+02:00',
				overdue: false,
				assignedMemberId: 'member-other',
				assignedMemberName: 'Mina',
			},
			{
				id: 'next-monday',
				title: 'Keller',
				nextDueAt: '2026-09-07T09:00:00+02:00',
				overdue: false,
				assignedMemberId: 'member-other',
				assignedMemberName: 'Mina',
			},
		],
	});

	expect(window).toMatchObject({
		todayKey: '2026-09-06',
		weekStartKey: '2026-08-31',
		sundayKey: '2026-09-06',
	});
	expect(window.from.toISOString()).toBe('2026-09-05T22:00:00.000Z');
	expect(window.to.toISOString()).toBe('2026-09-06T21:59:59.999Z');
	expect(agenda.overdue.map((item) => item.key)).toEqual(['chore:overdue-other']);
	expect(agenda.upcoming.map((item) => item.key).sort()).toEqual(
		['event:all-day:0', 'event:ongoing:0', 'event:weekly:1', 'chore:sunday-other'].sort(),
	);
	expect(agenda.upcoming.every((item) => item.dayKey === '2026-09-06')).toBe(true);
	expect(agenda.upcoming.find((item) => item.key === 'event:ongoing:0')?.detail).toContain('läuft');
});

test('does not label an ended overnight event as running', () => {
	const agenda = getWeekAgenda({
		shareCode: 'WG/1',
		currentMemberId: 'member-me',
		dueChores: [],
		events: [
			event({
				eventId: 'ended-overnight',
				title: 'Wochenendgäste',
				startsAt: '2026-09-05T20:00:00.000Z',
				endsAt: '2026-09-06T06:00:00.000Z',
			}),
		],
		now: Date.parse('2026-09-06T15:00:00.000Z'),
	});

	expect(agenda.upcoming).toEqual([
		expect.objectContaining({
			key: 'event:ended-overnight:0',
			dayKey: '2026-09-06',
			detail: 'Endete heute um 08:00',
		}),
	]);
});

test('uses Berlin dates across Sundays, Mondays, year boundaries, and DST changes', () => {
	const spring = getBerlinWeekWindow(Date.parse('2026-03-29T01:30:00.000Z'));
	const fall = getBerlinWeekWindow(Date.parse('2026-10-25T01:30:00.000Z'));
	const monday = getBerlinWeekWindow(Date.parse('2026-10-25T23:30:00.000Z'));
	const newYear = getBerlinWeekWindow(Date.parse('2027-01-01T12:00:00.000Z'));

	expect(spring).toMatchObject({
		todayKey: '2026-03-29',
		weekStartKey: '2026-03-23',
		sundayKey: '2026-03-29',
	});
	expect(spring.to.getTime() + 1 - spring.from.getTime()).toBe(23 * 60 * 60 * 1000);
	expect(fall).toMatchObject({
		todayKey: '2026-10-25',
		weekStartKey: '2026-10-19',
		sundayKey: '2026-10-25',
	});
	expect(fall.to.getTime() + 1 - fall.from.getTime()).toBe(25 * 60 * 60 * 1000);
	expect(monday).toMatchObject({
		todayKey: '2026-10-26',
		weekStartKey: '2026-10-26',
		sundayKey: '2026-11-01',
	});
	expect(newYear).toMatchObject({
		todayKey: '2027-01-01',
		weekStartKey: '2026-12-28',
		sundayKey: '2027-01-03',
	});
});

test('keeps recurring events at their Berlin wall time over both DST transitions', () => {
	const springWindow = getBerlinWeekWindow(Date.parse('2026-03-29T01:30:00.000Z'));
	const fallWindow = getBerlinWeekWindow(Date.parse('2026-10-25T01:30:00.000Z'));
	const recurringEvent = (startsAt: string): EventInput => ({
		id: 'weekly',
		title: 'Abendessen',
		description: null,
		startsAt,
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=WEEKLY',
	});

	expect(
		expandRecurrence(
			recurringEvent('2026-03-22T19:00:00.000Z'),
			springWindow.from,
			springWindow.to,
		)[0]?.startsAt,
	).toBe('2026-03-29T18:00:00.000Z');
	expect(
		expandRecurrence(recurringEvent('2026-10-18T18:00:00.000Z'), fallWindow.from, fallWindow.to)[0]
			?.startsAt,
	).toBe('2026-10-25T19:00:00.000Z');
});
