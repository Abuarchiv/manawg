import assert from 'node:assert/strict';
import test from 'node:test';
import {
	NETWORK_ERROR_CODE,
	RATE_LIMITED_MESSAGE,
	READ_ONLY_MESSAGE,
	SESSION_EXPIRED_MESSAGE,
} from '@/core/http/error-codes';
import { PAYPAL_STALE_CODES, paypalErrorMessage } from './paypal-errors';

test('codes without a started payment map to their own message, unclear ones to null', () => {
	for (const code of ['no_open_debt', 'paypal_onboarding_pending', 'paypal_order_in_progress']) {
		assert.ok(paypalErrorMessage(code));
	}
	assert.equal(paypalErrorMessage('paypal_capture_failed'), null);
	assert.equal(paypalErrorMessage('paypal_capture_pending'), null);
});

test('every stale code has a message', () => {
	for (const code of PAYPAL_STALE_CODES) assert.ok(paypalErrorMessage(code), code);
});

test('a rate-limited request shows the shared copy, whatever the code spelling', () => {
	for (const code of ['too_many_requests', 'rate_limited', 'paypal_rate_limited']) {
		assert.equal(paypalErrorMessage(code), RATE_LIMITED_MESSAGE, code);
	}
});

test('rejections before any payment use the shared copy; network and server errors stay unclear', () => {
	assert.equal(paypalErrorMessage('migration_read_only'), READ_ONLY_MESSAGE);
	assert.equal(paypalErrorMessage('auth_required'), SESSION_EXPIRED_MESSAGE);
	assert.equal(paypalErrorMessage('not_a_member'), 'Tritt der WG erneut bei.');
	assert.equal(paypalErrorMessage(NETWORK_ERROR_CODE), null);
	assert.equal(paypalErrorMessage('internal_error'), null);
});
