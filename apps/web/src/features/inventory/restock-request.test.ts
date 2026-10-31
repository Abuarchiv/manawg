import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { InventoryItemDto } from './inventory';

const item: InventoryItemDto = {
	id: '11111111-1111-4111-8111-111111111111',
	wgId: '22222222-2222-4222-8222-222222222222',
	name: 'Milk',
	quantity: 0,
	threshold: 0,
	unit: 'pack',
	category: 'kitchen',
	lastDecrementedAt: null,
	decrementCount30d: 0,
	createdAt: '2026-10-31T10:00:00Z',
	updatedAt: '2026-10-31T10:00:00Z',
};
const purchase = { id: '33333333-3333-4333-8333-333333333333', boughtAt: item.createdAt };
const requests: { body: string; headers: Record<string, string> }[] = [];
let reply: { ok: false; status: number; error: string } = {
	ok: false,
	status: 0,
	error: 'Netzwerkfehler',
};
mock.module('@/core/infra/api-client', {
	namedExports: {
		apiFetch: async (_url: string, init: (typeof requests)[number]) => {
			requests.push(init);
			return reply;
		},
	},
});
const { restockItem } = await import('./restock-request');

test('purchase retries retain their intent and stop offering a purchase that changed', async () => {
	const keys = new Map<string, string>();
	const input = { shareCode: 'TEST1234', memberId: 'member', item, keys, purchase };
	assert.equal((await restockItem(input)).kind, 'error');
	assert.equal((await restockItem(input)).kind, 'error');
	assert.equal(requests.length, 2);
	assert.deepEqual(JSON.parse(requests[0]?.body ?? '{}'), { quantityDelta: 1, purchase });
	assert.equal(requests[0]?.headers['Idempotency-Key'], requests[1]?.headers['Idempotency-Key']);
	assert.equal(keys.size, 1);
	reply = { ok: false, status: 409, error: 'inventory_purchase_changed' };
	assert.equal((await restockItem(input)).kind, 'gone');
	assert.equal(keys.size, 0);
});

test('ordinary quick restock does not acquire a purchase body', async () => {
	requests.length = 0;
	reply = { ok: false, status: 0, error: 'Netzwerkfehler' };
	await restockItem({ shareCode: 'TEST1234', memberId: 'member', item, keys: new Map() });
	assert.deepEqual(JSON.parse(requests[0]?.body ?? '{}'), { quantityDelta: 1 });
});
