import assert from 'node:assert/strict';
import test from 'node:test';

const { filterExpenses } = await import('./expense-filter');

const expense = (id: string, description: string, paidBy: string, debtors: string[]) => ({
	id,
	description,
	category: 'sonstiges' as const,
	paidByMemberId: paidBy,
	amountCents: 1000,
	currency: 'EUR',
	imageUrl: null,
	occurredAt: '2026-01-01T12:00:00.000Z',
	createdAt: '2026-01-01T12:00:00.000Z',
	updatedAt: '2026-01-01T12:00:00.000Z',
	splits: debtors.map((debtorMemberId) => ({
		id: `${id}-${debtorMemberId}`,
		debtorMemberId,
		amountCents: 500,
		settledAt: null,
	})),
});
const list = [
	expense('1', 'Wocheneinkauf REWE', 'me', ['me', 'tim']),
	expense('2', 'Strom', 'tim', ['tim', 'me']),
	expense('3', 'Pizza', 'tim', ['tim', 'ann']),
];
const ids = (items: ReadonlyArray<{ id: string }>) => items.map((item) => item.id);

test('the history filter narrows by the member role', () => {
	assert.deepEqual(ids(filterExpenses(list, 'all', 'me')), ['1', '2', '3']);
	assert.deepEqual(ids(filterExpenses(list, 'paid', 'me')), ['1']);
	assert.deepEqual(ids(filterExpenses(list, 'involved', 'me')), ['1', '2']);
});

test('search matches description, category and payer, ignoring case and umlauts', async () => {
	const { matchesExpenseQuery } = await import('./expense-filter');
	const e = {
		...expense('e1', 'Wocheneinkauf Müsli', 'm1', ['m2']),
		category: 'lebensmittel' as const,
	};
	const name = (id: string) => (id === 'm1' ? 'Jürgen' : 'Mina');
	assert.equal(matchesExpenseQuery(e, 'musli', name), true);
	assert.equal(matchesExpenseQuery(e, 'JURGEN woche', name), true);
	assert.equal(matchesExpenseQuery(e, 'miete', name), false);
	assert.equal(matchesExpenseQuery(e, '  ', name), true);
});
