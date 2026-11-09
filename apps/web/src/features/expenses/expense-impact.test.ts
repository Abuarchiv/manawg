import assert from 'node:assert/strict';
import test from 'node:test';
import { getExpenseImpact, savedExpenseMessage } from './expense-impact';

const split = (debtorMemberId: string, amountCents: number, settledAt: string | null = null) => ({
	debtorMemberId,
	amountCents,
	settledAt,
});

test('shows what an expense means for the viewer', () => {
	const paidByMe = {
		paidByMemberId: 'me',
		amountCents: 3000,
		splits: [split('me', 1000), split('a', 1000), split('b', 1000, '2026-09-01')],
	};
	assert.deepEqual(getExpenseImpact(paidByMe, 'me'), { kind: 'lent', cents: 1000 });
	assert.deepEqual(getExpenseImpact(paidByMe, 'a'), { kind: 'owe', cents: 1000 });
	assert.deepEqual(getExpenseImpact(paidByMe, 'b'), { kind: 'settled', cents: 1000 });
	assert.deepEqual(getExpenseImpact(paidByMe, 'c'), { kind: 'none', cents: 3000 });

	const allSettled = { ...paidByMe, splits: [split('a', 1500, '2026-09-01'), split('me', 1500)] };
	assert.deepEqual(getExpenseImpact(allSettled, 'me'), { kind: 'settled', cents: 1500 });

	const onlyMine = { paidByMemberId: 'me', amountCents: 500, splits: [] };
	assert.deepEqual(getExpenseImpact(onlyMine, 'me'), { kind: 'own', cents: 500 });

	const zeroShare = { paidByMemberId: 'a', amountCents: 500, splits: [split('me', 0)] };
	assert.deepEqual(getExpenseImpact(zeroShare, 'me'), { kind: 'none', cents: 500 });
});

test('the saved toast says what the expense means for the saver', () => {
	const names: Record<string, string> = { me: 'Ich', a: 'Mina', b: 'Jo' };
	const nameOf = (id: string) => names[id] ?? '?';
	const base = { currency: 'EUR' };
	const message = (
		expense: Parameters<typeof savedExpenseMessage>[0],
		viewer = 'me',
		edit = false,
	) => savedExpenseMessage(expense, viewer, nameOf, 'en', edit);

	const paidByMe = {
		...base,
		paidByMemberId: 'me',
		amountCents: 3000,
		splits: [split('me', 1000), split('a', 1000), split('b', 1000)],
	};
	assert.deepEqual(message(paidByMe), {
		key: 'expenses-form.notices.savedLent',
		values: { amount: '€20.00', count: 2, name: 'Mina' },
	});
	assert.deepEqual(message({ ...paidByMe, splits: [split('me', 2000), split('a', 1000)] }), {
		key: 'expenses-form.notices.savedLent',
		values: { amount: '€10.00', count: 1, name: 'Mina' },
	});
	assert.deepEqual(message(paidByMe, 'a'), {
		key: 'expenses-form.notices.savedOwe',
		values: { amount: '€10.00', payer: 'Ich' },
	});
	const own = { ...base, paidByMemberId: 'me', amountCents: 500, splits: [split('me', 500)] };
	assert.deepEqual(message(own), { key: 'expenses-form.notices.savedOwn' });
	assert.deepEqual(message(paidByMe, 'c'), { key: 'expenses-form.notices.saved' });
	assert.deepEqual(message(paidByMe, 'c', true), { key: 'expenses-form.notices.updated' });
});
