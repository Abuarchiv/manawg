import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
	createAction,
	makeQueueModule,
	restoreGlobals,
	setQueue,
} from './support/offline-harness.ts';

afterEach(restoreGlobals);

async function syncThrice(message: string) {
	let uploads = 0;
	const { module } = await makeQueueModule({
		images: {
			uploadPendingImageToken: async () => {
				uploads += 1;
				throw new Error(message);
			},
		},
	});
	await setQueue(module, [
		createAction({
			payload: { content: 'x', kind: 'info', imageUrl: 'manawg-pending-image:p1' },
		}),
	]);
	for (let round = 0; round < 3; round += 1) {
		await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	}
	return { uploads, action: module.readOfflineQueue()[0] };
}

for (const message of [
	'sign-failed:404:wg_not_found',
	'sign-failed:403:forbidden',
	'sign-failed:400:file_too_large',
]) {
	test(`${message} holds the photo action for review after one upload`, async () => {
		const { uploads, action } = await syncThrice(message);
		assert.equal(action.needsReview, 'server');
		assert.equal(uploads, 1);
	});
}

for (const message of [
	'sign-failed:503:feature_disabled',
	'sign-failed:429:upload_sign_rate_limited',
	'sign-failed:401:auth_required',
	'upload-failed:403',
]) {
	test(`${message} stays retryable`, async () => {
		const { uploads, action } = await syncThrice(message);
		assert.equal(action.needsReview, undefined);
		assert.equal(uploads, 3);
	});
}

test('a member context change while signing asks for a new sign-in and retries', async () => {
	const { uploads, action } = await syncThrice('sign-failed:409:member_context_changed');
	assert.equal(action.lastError, 'reauth');
	assert.equal(action.needsReview, undefined);
	assert.equal(uploads, 3);
});
