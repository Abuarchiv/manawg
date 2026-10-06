import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});

const { unreadableJsonBody } = await import('./api-errors');

test('an oversized body answers 413 so the client shortens it instead of retrying', async () => {
	const response = unreadableJsonBody(new Error('payload_too_large'));
	assert.equal(response.status, 413);
	assert.deepEqual(await response.json(), {
		error: 'payload_too_large',
		code: 'payload_too_large',
	});
});

test('malformed or missing JSON answers 400 invalid_json', async () => {
	for (const err of [new Error('invalid_json'), new SyntaxError('Unexpected token'), 'oops']) {
		const response = unreadableJsonBody(err);
		assert.equal(response.status, 400);
		assert.deepEqual(await response.json(), { error: 'invalid_json' });
	}
});
