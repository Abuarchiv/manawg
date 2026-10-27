import assert from 'node:assert/strict';
import test from 'node:test';
import { withEnv } from '../../../tests/support/env';
import { getPrivateImageKeyFromStoredUrl, isAllowedImageUrlForWg } from './image-url';

const wgId = '11111111-1111-4111-8111-111111111111';
const otherWgId = '99999999-9999-4999-8999-999999999999';
const objectKey = `manawg/${wgId}/expense/22222222-2222-4222-8222-222222222222.jpg`;

test('stored private image URLs keep their key across deployment origins', () => {
	withEnv({ NEXT_PUBLIC_APP_URL: 'https://current.example' }, () => {
		const historicalUrl = `https://old-preview.example/api/upload/read?key=${encodeURIComponent(objectKey)}`;
		assert.deepEqual(getPrivateImageKeyFromStoredUrl(historicalUrl), { key: objectKey, wgId });
		assert.equal(isAllowedImageUrlForWg(historicalUrl, wgId), false);
		assert.equal(
			isAllowedImageUrlForWg(
				`https://current.example/api/upload/read?key=${encodeURIComponent(objectKey)}`,
				wgId,
			),
			true,
		);
	});
});

test('stored private image URL parsing rejects mismatched WG keys and noncanonical URLs', () => {
	const validUrl = `https://old-preview.example/api/upload/read?key=${encodeURIComponent(objectKey)}`;
	assert.equal(getPrivateImageKeyFromStoredUrl(validUrl, otherWgId), null);
	assert.equal(getPrivateImageKeyFromStoredUrl(`${validUrl}&extra=1`), null);
	assert.equal(
		getPrivateImageKeyFromStoredUrl(validUrl.replace('/api/upload/read', '/api/upload/other')),
		null,
	);
	assert.equal(
		getPrivateImageKeyFromStoredUrl(
			`https://old-preview.example/api/upload/read?key=${encodeURIComponent(`manawg/${otherWgId}/expense/22222222-2222-4222-8222-222222222222.jpg`)}`,
			wgId,
		),
		null,
	);
});
