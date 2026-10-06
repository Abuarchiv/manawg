import assert from 'node:assert/strict';
import test from 'node:test';
import { isTerminalPayPalOrderCreationError } from './paypal';

test('only definitive Payee account errors release an order-creation reservation', () => {
	assert.equal(
		isTerminalPayPalOrderCreationError(new Error('paypal_api_422_PAYEE_ACCOUNT_INVALID')),
		true,
	);
	assert.equal(
		isTerminalPayPalOrderCreationError(new Error('paypal_api_422_DUPLICATE_REQUEST_ID')),
		false,
	);
	assert.equal(isTerminalPayPalOrderCreationError(new Error('paypal_api_503')), false);
});
