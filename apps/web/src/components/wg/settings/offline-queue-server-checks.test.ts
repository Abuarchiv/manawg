import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offlineActionInspectHref, SERVER_CHECKS } from './offline-queue-server-checks';

const note = (type: string, payload: Record<string, unknown>, data: unknown) => {
	const check = SERVER_CHECKS[type];
	assert.ok(check, type);
	return check.note(payload, data as never, 'de');
};

test('every queued action type reads an existing list route', () => {
	const paths = new Set(Object.values(SERVER_CHECKS).map((check) => check.path));
	assert.deepEqual([...paths].sort(), [
		'absences',
		'announcements',
		'chores',
		'expenses',
		'recurring-expenses',
		'shopping',
	]);
	assert.equal(SERVER_CHECKS['expense.update'], undefined);
});

test('a queued entry already on the server is named, trimmed, with its state', () => {
	assert.deepEqual(
		note('shopping.create', { name: ' Milch ' }, { items: [{ name: 'Milch', boughtAt: 'x' }] }),
		{ key: 'offline.serverCheck.shoppingDuplicate', values: { done: 'yes' } },
	);
	assert.deepEqual(
		note('shopping.update', { itemId: 'i1' }, { items: [{ id: 'i1', boughtAt: null }] }),
		{
			key: 'offline.serverCheck.shoppingFound',
			values: { done: 'no' },
		},
	);
	assert.deepEqual(
		note(
			'announcement.create',
			{ content: 'Party' },
			{ announcements: [{ content: 'Party ', resolvedAt: 'x' }] },
		),
		{ key: 'offline.serverCheck.announcementDuplicate', values: { resolved: 'yes' } },
	);
	assert.deepEqual(
		note('chore.create', { title: 'Bad' }, { chores: [{ title: 'Bad', intervalDays: 7 }] }),
		{
			key: 'offline.serverCheck.choreDuplicate',
			values: { days: 7 },
		},
	);
	assert.deepEqual(note('chore.complete', { choreId: 'c1' }, { chores: [{ id: 'c1' }] }), {
		key: 'offline.serverCheck.choreFound',
	});
});

test('a different amount, member or day is no duplicate', () => {
	const notFound = { key: 'offline.serverCheck.notFound' };
	assert.deepEqual(
		note(
			'expense.create',
			{ description: 'Pizza', amountCents: 1200 },
			{ expenses: [{ description: 'Pizza', amountCents: 1300 }] },
		),
		notFound,
	);
	assert.deepEqual(
		note(
			'expense.create',
			{ description: 'Pizza', amountCents: 1200 },
			{ expenses: [{ description: 'Pizza', amountCents: 1200 }] },
		),
		{ key: 'offline.serverCheck.expenseDuplicate' },
	);
	const absence = {
		memberId: 'm1',
		startDate: '2026-11-01T23:00:00.000Z',
		endDate: '2026-11-03T22:59:59.999Z',
	};
	assert.deepEqual(note('absence.create', absence, { absences: [absence] }), {
		key: 'offline.serverCheck.absenceDuplicate',
	});
	assert.deepEqual(
		note('absence.create', absence, { absences: [{ ...absence, memberId: 'm2' }] }),
		notFound,
	);
	assert.deepEqual(
		note('absence.create', absence, { absences: [{ ...absence, endDate: 'x' }] }),
		notFound,
	);
});

test('a target the server no longer has is reported as gone', () => {
	assert.deepEqual(note('shopping.update', { itemId: 'i1' }, { items: [] }), {
		key: 'offline.serverCheck.shoppingGone',
	});
	assert.deepEqual(note('chore.complete', { choreId: 'c1' }, { chores: [{ id: 'c2' }] }), {
		key: 'offline.serverCheck.choreGone',
	});
	assert.deepEqual(
		note('recurring.advance', { recurringExpenseId: 'r1' }, { recurringExpenses: [] }),
		{
			key: 'offline.serverCheck.templateGone',
		},
	);
});

test('recurring checks match the template by text and amount, or by id for a booking', () => {
	const template = {
		id: 'r1',
		description: 'Miete',
		amountCents: 500,
		nextDueAt: '2026-12-01T00:00:00.000Z',
	};
	const create = (amountCents: number) =>
		note(
			'recurring.create',
			{ description: ' Miete', amountCents },
			{ recurringExpenses: [template] },
		);
	assert.equal(create(500).key, 'offline.conflict.templateExists');
	assert.deepEqual(create(600), { key: 'offline.serverCheck.notFound' });
	const advance = (id: string, expected: string) =>
		note(
			'recurring.advance',
			{ recurringExpenseId: id, expectedRecurringNextDueAt: expected },
			{ recurringExpenses: [template] },
		);
	assert.equal(advance('r1', template.nextDueAt).key, 'offline.conflict.advanceSame');
	assert.equal(advance('r1', '2026-11-01T00:00:00.000Z').key, 'offline.conflict.advanceMoved');
	assert.equal(advance('r2', template.nextDueAt).key, 'offline.serverCheck.templateGone');
});

test('the inspect link opens the page of the queued entry', () => {
	const href = (type: string) => offlineActionInspectHref('AB CD', { type } as never);
	assert.equal(href('shopping.update'), '/wg/AB%20CD/shopping');
	assert.equal(href('announcement.create'), '/wg/AB%20CD/pinboard');
	assert.equal(href('expense.update'), '/wg/AB%20CD/expenses');
	assert.equal(href('recurring.advance'), '/wg/AB%20CD/expenses');
	assert.equal(href('absence.create'), '/wg/AB%20CD/chores');
});
