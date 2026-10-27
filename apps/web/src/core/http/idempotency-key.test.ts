import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	createIdempotencyKey,
	isIdempotencyKey,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from './idempotency-key';

describe('shouldReleaseIdempotencyKey', () => {
	const cases: Array<[number, string | undefined, boolean]> = [
		[0, undefined, false],
		[400, undefined, true],
		[404, undefined, true],
		[409, undefined, true],
		[429, undefined, false],
		[500, undefined, false],
		[503, undefined, false],
		[409, 'idempotency_response_pending', false],
		[409, 'name_invalid', true],
	];
	for (const [status, error, expected] of cases) {
		test(`${status} ${error ?? '-'} -> ${expected}`, () => {
			assert.equal(shouldReleaseIdempotencyKey(status, error), expected);
		});
	}
	test('null error counts as no error', () => {
		assert.equal(shouldReleaseIdempotencyKey(400, null), true);
	});
});

describe('resolveIdempotencyKey', () => {
	test('reuses the pending key for the same fingerprint', () => {
		const key = createIdempotencyKey();
		assert.ok(key);
		assert.equal(resolveIdempotencyKey({ fingerprint: 'a', key }, 'a'), key);
	});
	test('makes a new key for another fingerprint or no pending request', () => {
		const key = createIdempotencyKey();
		assert.ok(key);
		const other = resolveIdempotencyKey({ fingerprint: 'a', key }, 'b');
		assert.ok(isIdempotencyKey(other));
		assert.notEqual(other, key);
		assert.ok(isIdempotencyKey(resolveIdempotencyKey(null, 'a')));
		assert.ok(isIdempotencyKey(resolveIdempotencyKey(undefined, 'a')));
	});
});

describe('isIdempotencyKey', () => {
	test('accepts UUIDs only', () => {
		assert.equal(isIdempotencyKey(crypto.randomUUID()), true);
		assert.equal(isIdempotencyKey('nope'), false);
		assert.equal(isIdempotencyKey(null), false);
	});
});
