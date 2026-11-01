import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	isRejectedPendingUpload,
	pendingUploadErrorMessage,
	uploadSignErrorMessage,
} from './image-upload-errors';

function failedWith(key: string) {
	return {
		key: 'common.errors.withSubject',
		values: { subject: { key: 'shell.upload.failed' }, detail: { key } },
	};
}

test('a 4xx answer to the upload PUT is final and explained', () => {
	const err = new Error('upload-failed:403');
	assert.equal(isRejectedPendingUpload(err), true);
	assert.deepEqual(pendingUploadErrorMessage(err), {
		key: 'common.errors.withSubject',
		values: {
			subject: { key: 'shell.upload.failed' },
			detail: { key: 'shell.upload.rejected' },
		},
	});
});

test('timeouts, rate limits and 5xx answers stay silently retryable', () => {
	for (const status of [408, 429, 500, 503]) {
		const err = new Error(`upload-failed:${status}`);
		assert.equal(isRejectedPendingUpload(err), false);
		assert.equal(pendingUploadErrorMessage(err), null);
	}
});

test('a request that never got an answer is retried silently', () => {
	for (const message of ['sign-network-failed', 'put-network-failed']) {
		const err = new Error(message);
		assert.equal(isRejectedPendingUpload(err), false);
		assert.equal(pendingUploadErrorMessage(err), null);
	}
});

test('an expired session is told apart from a revoked membership', () => {
	assert.deepEqual(
		uploadSignErrorMessage(401, 'auth_required'),
		failedWith('common.errors.sessionExpired'),
	);
	assert.deepEqual(
		pendingUploadErrorMessage(new Error('sign-failed:401:auth_required')),
		failedWith('common.errors.sessionExpired'),
	);
	for (const code of ['not_a_member', '']) {
		assert.deepEqual(
			uploadSignErrorMessage(401, code),
			failedWith('common.errors.authInvalidated'),
		);
	}
});
