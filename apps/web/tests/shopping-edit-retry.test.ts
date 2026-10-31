import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { ShoppingItem } from '../src/features/shopping/components/shopping-types.ts';
import type { ShoppingActionContext } from '../src/features/shopping/hooks/shopping-action-context.ts';

type Reply =
	| { ok: true; data: { item: ShoppingItem } }
	| { ok: false; status: number; error: string };

const replies: Reply[] = [];
const requests: Array<{ url: string; idempotencyKey: string | undefined }> = [];

mock.module('react', {
	namedExports: {
		useCallback: (callback: unknown) => callback,
		useRef: (current: unknown) => ({ current }),
	},
});
mock.module('@/core/infra/api-client', {
	namedExports: {
		apiFetch: async (url: string, init: { headers?: Record<string, string> }) => {
			requests.push({
				url,
				idempotencyKey: init.headers?.['Idempotency-Key'],
			});
			const reply = replies.shift();
			assert.ok(reply, 'test must provide one API reply for each request');
			return reply;
		},
	},
});
mock.module('@/core/offline/offline-client', {
	namedExports: { readOfflineQueue: () => [] },
});

const { useShoppingEdit } = await import('../src/features/shopping/hooks/use-shopping-edit.ts');

const opened: ShoppingItem = {
	id: '11111111-1111-4111-8111-111111111111',
	addedByMemberId: '22222222-2222-4222-8222-222222222222',
	name: 'Milch',
	quantity: '1 L',
	boughtAt: null,
	boughtByMemberId: null,
	createdAt: '2026-10-31T00:00:00.000Z',
	updatedAt: '2026-10-31T00:00:00.000Z',
};

function resetReplies(...next: Reply[]): void {
	replies.splice(0, replies.length, ...next);
	requests.length = 0;
}

function createEdit() {
	let items = [opened];
	const pending = new Map<string, ShoppingItem>();
	const togglingRef = { current: new Set<string>() };
	const ctx: ShoppingActionContext = {
		wg: { id: 'wg-1', shareCode: 'ABCD2345' },
		memberId: opened.addedByMemberId,
		encodedShareCode: 'ABCD2345',
		commit(update: (current: ShoppingItem[]) => ShoppingItem[]) {
			items = update(items);
		},
		pending: {
			set(item: ShoppingItem) {
				pending.set(item.id, item);
			},
			delete(id: string) {
				pending.delete(id);
			},
			has: (id: string) => pending.has(id),
		},
		load: async () => {},
		isPending: () => false,
		togglingRef,
		refreshCount() {},
		setToggleError() {},
		setToggleNotice() {},
	};

	// biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked for this synchronous hook harness.
	const edit = useShoppingEdit(ctx);
	return {
		edit,
		items: () => items,
	};
}

test('an unknown edit outcome retries the identical payload with its original key', async () => {
	const saved: ShoppingItem = {
		...opened,
		name: 'Hafermilch',
		updatedAt: '2026-10-31T00:01:00.000Z',
	};
	resetReplies(
		{ ok: false, status: 0, error: 'network' },
		{ ok: true, data: { item: saved } },
		{ ok: false, status: 0, error: 'network' },
	);
	const { edit, items } = createEdit();
	const fields = { name: 'Hafermilch', quantity: '1 L' };

	assert.deepEqual(await edit(opened, fields), { key: 'shopping.edit.needsConnection' });
	assert.equal(items()[0]?.name, opened.name, 'the failed optimistic edit rolls back');
	const firstKey = requests[0]?.idempotencyKey;
	assert.ok(firstKey);

	assert.equal(await edit(opened, fields), null);
	assert.equal(requests[1]?.idempotencyKey, firstKey);
	assert.equal(items()[0]?.name, saved.name, 'the replayed success is committed to the row');

	// A completed replay must retire its key; a later identical request starts a new attempt.
	await edit(opened, fields);
	assert.ok(requests[2]?.idempotencyKey);
	assert.notEqual(requests[2]?.idempotencyKey, firstKey);
});

test('changed payloads get a new key and a definitive version conflict retires that key', async () => {
	resetReplies(
		{ ok: false, status: 0, error: 'network' },
		{ ok: false, status: 0, error: 'network' },
		{ ok: false, status: 409, error: 'shopping_item_changed' },
		{ ok: false, status: 0, error: 'network' },
	);
	const { edit } = createEdit();
	const firstFields = { name: 'Hafermilch', quantity: '1 L' };
	const changedFields = { name: 'Milch', quantity: '2 L' };

	await edit(opened, firstFields);
	const firstKey = requests[0]?.idempotencyKey;
	assert.ok(firstKey);

	await edit(opened, changedFields);
	const changedKey = requests[1]?.idempotencyKey;
	assert.ok(changedKey);
	assert.notEqual(changedKey, firstKey, 'a different request body must not reuse the old key');

	assert.deepEqual(await edit(opened, changedFields), { key: 'shopping.edit.changed' });
	assert.equal(requests[2]?.idempotencyKey, changedKey, 'an unknown retry keeps its key');

	await edit(opened, changedFields);
	assert.notEqual(
		requests[3]?.idempotencyKey,
		changedKey,
		'a definitive 409 lets the next attempt use a fresh key',
	);
});
