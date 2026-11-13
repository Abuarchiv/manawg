import assert from 'node:assert/strict';
import test from 'node:test';
import { expenseDeletionNotices, expenseUpdateNotices } from './expense-change-notices';

const day = new Date('2026-11-01T12:00:00.000Z');
const version = (amountCents: number, shares: Array<[string, number]>, occurredAt = day) => ({
	amountCents,
	occurredAt,
	shares: shares.map(([debtorMemberId, cents]) => ({ debtorMemberId, amountCents: cents })),
});

test('an amount edit tells each debtor their old and new share, but not the editor', () => {
	const notices = expenseUpdateNotices({
		actorId: 'payer',
		before: version(900, [
			['payer', 300],
			['a', 300],
			['b', 300],
		]),
		after: version(1200, [
			['payer', 400],
			['a', 400],
			['b', 400],
		]),
	});
	assert.deepEqual(notices, [{ memberIds: ['a', 'b'], fromCents: 300, toCents: 400 }]);
});

test('members added to or dropped from the split are told, with a zero share on the missing side', () => {
	const notices = expenseUpdateNotices({
		actorId: 'payer',
		before: version(800, [
			['payer', 400],
			['a', 400],
		]),
		after: version(800, [
			['payer', 400],
			['b', 400],
		]),
	});
	assert.deepEqual(notices, [
		{ memberIds: ['a'], fromCents: 400, toCents: 0 },
		{ memberIds: ['b'], fromCents: 0, toCents: 400 },
	]);
});

test('an edit that leaves amount, shares and date alone stays silent', () => {
	const shares: Array<[string, number]> = [
		['payer', 400],
		['a', 400],
	];
	assert.deepEqual(
		expenseUpdateNotices({
			actorId: 'payer',
			before: version(800, shares),
			after: version(800, shares),
		}),
		[],
	);
});

test('a date-only edit still reaches the debtors, with their unchanged share', () => {
	const shares: Array<[string, number]> = [
		['payer', 400],
		['a', 400],
	];
	assert.deepEqual(
		expenseUpdateNotices({
			actorId: 'payer',
			before: version(800, shares),
			after: version(800, shares, new Date('2026-11-02T12:00:00.000Z')),
		}),
		[{ memberIds: ['a'], fromCents: 400, toCents: 400 }],
	);
});

test('a deletion moves a debtor by their share and the payer by what the others owed', () => {
	const shares = [
		{ debtorMemberId: 'payer', amountCents: 200 },
		{ debtorMemberId: 'a', amountCents: 300 },
		{ debtorMemberId: 'b', amountCents: 300 },
	];
	assert.deepEqual(expenseDeletionNotices({ actorId: 'a', payerId: 'payer', shares }), [
		{ memberIds: ['payer'], amountCents: 600, payer: true },
		{ memberIds: ['b'], amountCents: 300, payer: false },
	]);
	assert.deepEqual(expenseDeletionNotices({ actorId: 'payer', payerId: 'payer', shares }), [
		{ memberIds: ['a', 'b'], amountCents: 300, payer: false },
	]);
});
