import assert from 'node:assert/strict';
import test from 'node:test';
import { isTerminalReplayStatus } from './offline-replay-rules';

test('a rejected request is terminal, replaying it cannot change the answer', () => {
	for (const status of [400, 401, 403, 404, 409, 410, 422]) {
		assert.equal(isTerminalReplayStatus(status), true, `status ${status}`);
	}
});

test('timeouts, Too Early and the rate limit are worth another attempt', () => {
	for (const status of [0, 408, 425, 429]) {
		assert.equal(isTerminalReplayStatus(status), false, `status ${status}`);
	}
});

test('server errors are retried, so they are not terminal', () => {
	for (const status of [200, 500, 502, 503]) {
		assert.equal(isTerminalReplayStatus(status), false, `status ${status}`);
	}
});
