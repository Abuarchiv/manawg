import assert from 'node:assert/strict';
import test from 'node:test';

const { buildAboSplits, buildEqualSplits, initialSplitMode } = await import(
	'../src/features/expenses/components/abos/abo-form-model.ts'
);

const anna = { id: 'a', name: 'Anna', color: null, active: true };
const ben = { id: 'b', name: 'Ben', color: null, active: true };
const cem = { id: 'c', name: 'Cem', color: null, active: false };

test('equal splits skip moved-out members and keep the exact sum', () => {
	assert.deepEqual(buildEqualSplits([anna, ben, cem], 1001), [
		{ debtorMemberId: 'a', amountCents: 501 },
		{ debtorMemberId: 'b', amountCents: 500 },
	]);
});

test('manual splits must add up to the amount', () => {
	const base = {
		amountCents: 1000,
		splitMode: 'manual' as const,
		activeMembers: [anna, ben],
		splitCandidates: [anna, ben],
	};
	assert.deepEqual(buildAboSplits({ ...base, manualSplits: { a: '6', b: '4' } }), [
		{ debtorMemberId: 'a', amountCents: 600 },
		{ debtorMemberId: 'b', amountCents: 400 },
	]);
	assert.equal(buildAboSplits({ ...base, manualSplits: { a: '6', b: '3' } }), 'splits_mismatch');
	assert.equal(buildAboSplits({ ...base, manualSplits: {} }), 'splits_empty');
	assert.equal(buildAboSplits({ ...base, manualSplits: { a: 'x' } }), 'invalid_share');
	assert.equal(buildAboSplits({ ...base, amountCents: null, manualSplits: {} }), 'amount_invalid');
});

test('an abo whose shares match the equal split opens in equal mode', () => {
	const initial = {
		description: 'Netflix',
		amountCents: 1000,
		paidByMemberId: 'a',
		intervalMonths: 1,
		nextDueAt: '2026-10-01T10:00:00.000Z',
		splits: buildEqualSplits([anna, ben], 1000),
	};
	assert.equal(initialSplitMode(initial, [anna, ben]), 'equal');
	assert.equal(
		initialSplitMode({ ...initial, splits: [{ debtorMemberId: 'a', amountCents: 1000 }] }, [
			anna,
			ben,
		]),
		'manual',
	);
	assert.equal(initialSplitMode(undefined, [anna, ben]), 'equal');
});
