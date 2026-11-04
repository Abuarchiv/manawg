import assert from 'node:assert/strict';
import test from 'node:test';
import { hasSettledShares } from './expense-delete-guard';

function split(debtorMemberId: string, settledAt: string | null = null) {
	return { debtorMemberId, settledAt };
}

test('an expense without settled shares stays deletable', () => {
	assert.equal(hasSettledShares({ paidByMemberId: 'A', splits: [split('A'), split('B')] }), false);
});

test('the payer having settled their own share does not block deletion', () => {
	assert.equal(
		hasSettledShares({
			paidByMemberId: 'A',
			splits: [split('A', '2026-09-01T00:00:00.000Z'), split('B')],
		}),
		false,
	);
});

test('a flatmate having settled their share blocks deletion', () => {
	assert.equal(
		hasSettledShares({
			paidByMemberId: 'A',
			splits: [split('A'), split('B', '2026-09-01T00:00:00.000Z')],
		}),
		true,
	);
});
