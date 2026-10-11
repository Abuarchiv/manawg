import assert from 'node:assert/strict';
import test from 'node:test';
import { isInvalidSubscriptionKeyError } from './web-push-errors';

test('local web-push key errors mark a subscription as undeliverable, VAPID and network errors do not', () => {
	const keyErrors = [
		'The subscription p256dh value should be 65 bytes long.',
		'The subscription auth key should be at least 16 bytes',
		'No user public key provided for encryption.',
		'No user auth provided for encryption.',
	];
	for (const message of keyErrors)
		assert.equal(isInvalidSubscriptionKeyError(new Error(message)), true);
	for (const message of [
		'Vapid public key should be 65 bytes long when decoded.',
		'Vapid private key must be a URL safe Base 64 (without "=")',
		'Socket timeout',
	]) {
		assert.equal(isInvalidSubscriptionKeyError(new Error(message)), false);
	}
	assert.equal(isInvalidSubscriptionKeyError('p256dh'), false);
});
