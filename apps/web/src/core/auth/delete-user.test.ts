import assert from 'node:assert/strict';
import test from 'node:test';

import { deleteAuthUser } from './delete-user';

const USER_ID = '12d54242-a3ba-47b9-9254-f152f1e44eb0';

function response(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function remove(fetchImpl: typeof fetch, timeoutMs = 100) {
	return deleteAuthUser('https://auth.example.test', 'service-role-test-key', USER_ID, {
		fetch: fetchImpl,
		timeoutMs,
	});
}

test('confirmed deletion and explicit user_not_found count as complete', async () => {
	assert.equal(await remove(async () => response(200, { user: null })), true);
	assert.equal(
		await remove(async () =>
			response(404, { error_code: 'user_not_found', message: 'User not found' }),
		),
		true,
	);
});

test('permission failures and unrelated 404 responses remain pending', async () => {
	assert.equal(await remove(async () => response(403, { error_code: 'not_admin' })), false);
	assert.equal(await remove(async () => response(404, { error_code: 'route_not_found' })), false);
});

test('a stalled Auth request is aborted and remains pending', async () => {
	const stalledFetch = (_input: RequestInfo | URL, init?: RequestInit) =>
		new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () =>
				reject(new DOMException('aborted', 'AbortError')),
			);
		});
	const keepAlive = setTimeout(() => {}, 100);
	try {
		assert.equal(await remove(stalledFetch, 20), false);
	} finally {
		clearTimeout(keepAlive);
	}
});
