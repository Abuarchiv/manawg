import assert from 'node:assert/strict';
import test from 'node:test';
import { hideStaleNetworkError } from '@/core/sync/collection-overlay';

const network = { status: 0, error: 'network_error' };

test('a network failure with rows on screen adds no banner', () => {
	assert.equal(hideStaleNetworkError(network, { silent: false, hasData: true }), true);
	assert.equal(hideStaleNetworkError(network, { silent: true, hasData: true }), true);
});

test('a network failure with nothing on screen still shows the error', () => {
	assert.equal(hideStaleNetworkError(network, { silent: false, hasData: false }), false);
});

test('an answer from the server still shows with rows on screen', () => {
	for (const status of [401, 403, 500]) {
		assert.equal(
			hideStaleNetworkError({ status, error: 'server_error' }, { silent: true, hasData: true }),
			false,
		);
	}
});
