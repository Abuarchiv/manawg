import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildEqualSplits,
	distributeCentsEqually,
	settledAtForOwnShare,
	splitValidationErrorCode,
	validateSplits,
} from './split-math';

test('an equal split adds up exactly and differs by at most one cent', () => {
	assert.deepEqual(distributeCentsEqually(1000, ['a', 'b', 'c']), [334, 333, 333]);
	assert.deepEqual(distributeCentsEqually(1, ['a', 'b']), [1, 0]);
});

test('an equal split refuses broken input instead of losing cents', () => {
	assert.throws(() => distributeCentsEqually(10.5, ['a']), /non-negative integer/);
	assert.throws(() => distributeCentsEqually(-1, ['a']), /non-negative integer/);
	assert.throws(() => distributeCentsEqually(100, []), /must not be empty/);
});

test('the leftover cent rotates, also for a negative offset', () => {
	const owner = (offset: number) =>
		buildEqualSplits(100, ['a', 'b', 'c'], offset).find((s) => s.amountCents === 34)
			?.debtorMemberId;
	assert.deepEqual([0, 1, 2, 3].map(owner), ['a', 'b', 'c', 'a']);
	assert.equal(owner(-1), 'c');
});

test('client splits must be whole, positive, unique and add up', () => {
	const a = { debtorMemberId: 'a', amountCents: 50 };
	assert.deepEqual(validateSplits(100, [a, { debtorMemberId: 'b', amountCents: 50 }]), {
		ok: true,
		splits: [a, { debtorMemberId: 'b', amountCents: 50 }],
	});
	assert.deepEqual(validateSplits(0, []), { ok: false, reason: 'empty' });
	assert.deepEqual(validateSplits(100, [{ debtorMemberId: 'a', amountCents: 99.5 }]), {
		ok: false,
		reason: 'invalid_amount',
	});
	assert.deepEqual(validateSplits(100, [a, a]), { ok: false, reason: 'duplicate_debtor' });
	assert.deepEqual(validateSplits(100, [a]), { ok: false, reason: 'sum_mismatch' });
});

test('each split failure has its own error code', () => {
	assert.equal(splitValidationErrorCode('duplicate_debtor'), 'splits_duplicate_debtor');
	assert.equal(splitValidationErrorCode('sum_mismatch'), 'splits_sum_mismatch');
	assert.equal(splitValidationErrorCode('empty'), 'splits_invalid');
});

test("the payer's own share is stored as settled, everyone else's as open", () => {
	assert.ok(settledAtForOwnShare('a', 'a') instanceof Date);
	assert.equal(settledAtForOwnShare('b', 'a'), null);
});
