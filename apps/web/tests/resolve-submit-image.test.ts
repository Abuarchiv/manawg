import assert from 'node:assert/strict';
import { test } from 'node:test';

const { resolveSubmitImage } = await import('../src/core/offline/resolve-submit-image.ts');

const token = 'manawg-pending-image:11111111-1111-4111-8111-111111111111';

test('online, a receipt left pending by a failed upload is uploaded at submit', async () => {
	const uploaded: string[] = [];
	const upload = async (value: string) => {
		uploaded.push(value);
		return 'https://cdn.test/receipt.jpg';
	};
	assert.deepEqual(await resolveSubmitImage(token, 'm1', true, upload), {
		url: 'https://cdn.test/receipt.jpg',
	});
	assert.deepEqual(uploaded, [token]);
	assert.equal(
		await resolveSubmitImage(token, 'm1', true, async () => {
			throw new Error('sign-failed:503');
		}),
		null,
	);
});

test('offline the token stays for the replay; plain URLs pass through', async () => {
	const never = async () => assert.fail('no upload');
	assert.deepEqual(await resolveSubmitImage(token, 'm1', false, never), { url: token });
	assert.deepEqual(await resolveSubmitImage('https://cdn.test/a.jpg', 'm1', true, never), {
		url: 'https://cdn.test/a.jpg',
	});
	assert.deepEqual(await resolveSubmitImage(null, 'm1', true, never), { url: null });
});

test('the pinboard names a failed image upload instead of asking to wait', async () => {
	const { default: messages } = await import('../src/shared/i18n/messages/index.ts');
	for (const catalog of Object.values(messages)) {
		assert.equal('imageUploading' in catalog.pinboard.errors, false);
		assert.ok(catalog.pinboard.errors.imageUploadFailed);
	}
});
