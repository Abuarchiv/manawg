import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

const { postAdminTransfer } = await import('../src/components/wg/settings/admin-transfer.ts');

function replaceFetch(t: TestContext, implementation: typeof fetch) {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = implementation;
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
}

const base = {
	adminsUrl: '/api/wg/CODE/members/target-1/admin',
	actorMemberId: 'admin-1',
	targetMemberId: 'target-1',
};

test('a retry after a lost response sends the same Idempotency-Key and frees it on success', async (t) => {
	const keys: Array<string | null> = [];
	const answers = [
		() => Promise.reject(new TypeError('network down')),
		() => Response.json({ member: { id: 'target-1', name: 'Mina' } }),
	];
	replaceFetch(t, async (_url, init) => {
		keys.push(new Headers(init?.headers).get('Idempotency-Key'));
		return answers.shift()?.() as Response;
	});
	let created = 0;
	const pending = { current: null as { fingerprint: string; key: string } | null };
	const deps = { ...base, pending, createKey: () => `key-${++created}` };

	assert.equal((await postAdminTransfer(deps)).ok, false);
	assert.deepEqual(pending.current, { fingerprint: 'target-1', key: 'key-1' });
	assert.equal((await postAdminTransfer(deps)).ok, true);
	assert.deepEqual(keys, ['key-1', 'key-1']);
	assert.equal(pending.current, null);
});

test('a definitive rejection frees the key and another member gets a fresh one', async (t) => {
	const keys: Array<string | null> = [];
	replaceFetch(t, async (_url, init) => {
		keys.push(new Headers(init?.headers).get('Idempotency-Key'));
		return Response.json({ error: 'member_inactive' }, { status: 409 });
	});
	let created = 0;
	const pending = { current: null as { fingerprint: string; key: string } | null };
	const deps = { ...base, pending, createKey: () => `key-${++created}` };

	assert.equal((await postAdminTransfer(deps)).ok, false);
	assert.equal(pending.current, null);
	await postAdminTransfer(deps);
	pending.current = { fingerprint: 'other', key: 'stale' };
	await postAdminTransfer(deps);
	assert.deepEqual(keys, ['key-1', 'key-2', 'key-3']);
});
