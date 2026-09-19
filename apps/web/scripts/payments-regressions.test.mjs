import assert from 'node:assert/strict';
import test from 'node:test';
import { filterPersistedMentionIds } from '../src/features/chat/chat-pure.ts';
import {
	isPayPalCaptureDebtChanged,
	shouldRetryPayPalCapture,
} from '../src/features/expenses/paypal-settlement.ts';

test('returns only mention IDs confirmed by the database insert', () => {
	assert.deepEqual(
		filterPersistedMentionIds(
			['member-a', 'member-b', 'member-c'],
			[{ mentionedMemberId: 'member-c' }, { mentionedMemberId: 'member-a' }],
		),
		['member-a', 'member-c'],
	);
});

test('accepts a capture that exactly settles the remaining debt', () => {
	assert.equal(isPayPalCaptureDebtChanged(1_000, 1_000), false);
	assert.equal(isPayPalCaptureDebtChanged(1_001, 1_000), true);
	assert.equal(isPayPalCaptureDebtChanged(undefined, 1_000), true);
});

test('retries transient PayPal capture responses but stops on client errors', () => {
	assert.equal(shouldRetryPayPalCapture({ ok: true, data: { status: 'PENDING' } }), true);
	assert.equal(shouldRetryPayPalCapture({ ok: false, status: 0, error: 'network' }), true);
	assert.equal(shouldRetryPayPalCapture({ ok: false, status: 503, error: 'server_error' }), true);
	assert.equal(shouldRetryPayPalCapture({ ok: false, status: 409, error: 'debt_changed' }), false);
});
