import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
	CLAIM_LEASE_MS,
	ClaimTable,
	idempotencyResponses,
	mockIdempotencyStore,
} from '../../../../../../tests/support/claim-table';
import { mockDb } from '../../../../../../tests/support/db-mock';
import { mockDrizzle } from '../../../../../../tests/support/drizzle-mock';
import {
	Stall,
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../tests/support/route-harness';

// The real route, idempotent write and claim helpers share one in-memory database; every
// `post()` behaves like its own server process.

const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const idemKey = '55555555-5555-4555-8555-555555555555';
const shoppingItems = { name: 'shopping_items' };

interface Item {
	id: string;
	createdAt: Date;
	[field: string]: unknown;
}

const table = new ClaimTable();
const transaction = new Stall();
const state = {
	items: [] as Item[],
	failInsert: false,
	reclaimOnRollback: false,
};

function reset(): void {
	table.rows = [];
	transaction.reset();
	state.items = [];
	state.failInsert = false;
	state.reclaimOnRollback = false;
}

const tx = {
	select: (columns: Record<string, unknown>) => table.select(columns),
	update: (target: unknown) => {
		assert.equal(target, idempotencyResponses);
		return table.update();
	},
	delete: () => table.delete(),
	insert: (target: unknown) => ({
		values: (values: Record<string, unknown>) => ({
			returning: async () => {
				assert.equal(target, shoppingItems);
				if (state.failInsert) throw new Error('connection reset');
				const item = { id: `item-${state.items.length + 1}`, createdAt: new Date(), ...values };
				state.items.push(item);
				return [item];
			},
		}),
	}),
};

async function withTransaction<T>(work: (handle: typeof tx) => Promise<T>): Promise<T> {
	await transaction.pass();
	const snapshot = { rows: table.snapshot(), items: [...state.items] };
	try {
		return await work(tx);
	} catch (err) {
		table.restore(snapshot.rows);
		state.items = snapshot.items;
		const slot = table.slot;
		if (state.reclaimOnRollback && slot) {
			slot.expiresAt = new Date(Date.now() + 20 * 60_000);
		}
		throw err;
	}
}

mockDrizzle();
mockObservability();
mockRateLimit();
mockWgMember({ wg: { id: wgId }, member: { memberId, name: 'Mina' } });
mockIdempotencyStore(table);
mockDb({
	idempotencyResponses,
	shoppingItems,
	withTransaction,
	db: { delete: () => table.delete() },
});
// A request that loses the claim to a live lease fails at once instead of polling.
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: async (scope: string, key: string) => {
			const cached = table.cached(scope, key);
			if (cached) return { won: false, cached };
			if (!table.claim(scope, key, CLAIM_LEASE_MS)) {
				throw new Error('idempotency_response_pending');
			}
			return { won: true };
		},
	},
});
mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/activity-feed', {
	namedExports: {
		postSystemNotice: async () => undefined,
		postChatSystemMessage: async () => undefined,
		resolveShoppingRequest: async () => undefined,
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: { dispatchNotificationSafely: async () => ({ warning: null }) },
});

const { POST } = await import('./route');

const post = (body: { name: string; bought?: boolean }) =>
	POST(
		request('/api/wg/MTE8PZAT/shopping', {
			method: 'POST',
			headers: { 'idempotency-key': idemKey },
			body,
		}),
		routeCtx(),
	);

test('a create stalled past its lease replays the request that took its key over', async () => {
	reset();
	const stalled = transaction.arm();
	const late = post({ name: 'Kaffee', bought: true });
	await stalled.reached;
	// The lease runs out while the first request stalls; a retry reclaims the key.
	(table.slot as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1_000);

	const retry = await post({ name: 'Kaffee', bought: true });
	assert.equal(retry.status, 200);
	const retryBody = await retry.json();
	assert.equal(retryBody.item.name, 'Kaffee');
	assert.ok(retryBody.item.boughtAt, 'a bought item is not caught by the open-name index');

	stalled.release();
	const lateResponse = await late;
	assert.equal(lateResponse.status, 200);
	assert.deepEqual(await lateResponse.json(), retryBody);
	assert.equal(state.items.length, 1);
});

test('a create stalled past its lease writes once when the reclaiming request has not locked yet', async () => {
	reset();
	const stalled = transaction.arm();
	const late = post({ name: 'Kaffee', bought: true });
	await stalled.reached;
	// Another request reclaimed the key with a fresh lease but has not reached its transaction.
	(table.slot as { expiresAt: Date }).expiresAt = new Date(Date.now() + CLAIM_LEASE_MS);

	stalled.release();
	const lateResponse = await late;
	assert.equal(lateResponse.status, 200);
	const reclaiming = await post({ name: 'Kaffee', bought: true });
	assert.deepEqual(await reclaiming.json(), await lateResponse.json());
	assert.equal(state.items.length, 1);
});

test('a rolled-back create frees its claim so the same key runs again at once', async () => {
	reset();
	state.failInsert = true;
	const failed = await post({ name: 'Milch' });
	// The pending-response error is answered as a retryable 503.
	assert.equal(failed.status, 503);
	assert.deepEqual(await failed.json(), {
		error: 'service_unavailable',
		code: 'idempotency_retryable',
	});
	assert.equal(table.slot, undefined);

	state.failInsert = false;
	const retry = await post({ name: 'Milch' });
	assert.equal(retry.status, 200);
	assert.equal(state.items.length, 1);
});

test('a rolled-back create keeps a claim another request took over', async () => {
	reset();
	state.failInsert = true;
	state.reclaimOnRollback = true;
	const failed = await post({ name: 'Milch' });
	assert.equal(failed.status, 503);
	assert.deepEqual(table.slot?.responseBody, { _claimed: true });
	assert.equal(state.items.length, 0);
});
