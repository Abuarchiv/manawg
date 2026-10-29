import assert from 'node:assert/strict';
import test from 'node:test';

const { buildRecurringSplits, buildEqualSplits, initialEqualParticipants } = await import(
	'../src/features/expenses/recurring-form-model.ts'
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
	assert.deepEqual(buildRecurringSplits({ ...base, manualSplits: { a: '6', b: '4' } }), [
		{ debtorMemberId: 'a', amountCents: 600 },
		{ debtorMemberId: 'b', amountCents: 400 },
	]);
	assert.equal(
		buildRecurringSplits({ ...base, manualSplits: { a: '6', b: '3' } }),
		'splits_mismatch',
	);
	assert.equal(buildRecurringSplits({ ...base, manualSplits: {} }), 'splits_empty');
	assert.equal(buildRecurringSplits({ ...base, manualSplits: { a: 'x' } }), 'invalid_share');
	assert.equal(
		buildRecurringSplits({ ...base, amountCents: null, manualSplits: {} }),
		'amount_invalid',
	);
});

test('a recurring expense whose shares match the equal split opens in equal mode', () => {
	const initial = {
		description: 'Netflix',
		category: 'leisure' as const,
		amountCents: 1000,
		paidByMemberId: 'a',
		intervalMonths: 1,
		nextDueAt: '2026-10-01T10:00:00.000Z',
		splits: buildEqualSplits([anna, ben], 1000),
	};
	assert.equal(initialEqualParticipants(initial, [anna, ben]), null);
	// One member carrying the whole amount is an equal split among that subset.
	assert.deepEqual(
		initialEqualParticipants({ ...initial, splits: [{ debtorMemberId: 'a', amountCents: 1000 }] }, [
			anna,
			ben,
		]),
		['a'],
	);
	const uneven = [
		{ debtorMemberId: 'a', amountCents: 600 },
		{ debtorMemberId: 'b', amountCents: 400 },
	];
	assert.equal(initialEqualParticipants({ ...initial, splits: uneven }, [anna, ben]), 'manual');
	assert.equal(initialEqualParticipants(undefined, [anna, ben]), null);
});
