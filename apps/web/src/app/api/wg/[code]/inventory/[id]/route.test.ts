import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const purchaseId = 'A1111111-1111-4111-8111-111111111111';
const itemIds = ['11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666666'];

let writes: Array<{ scope: string; key: string | null }> = [];
let mutations: Array<Record<string, unknown>> = [];
let storedResponses: Array<{ scope: string; key: string | null }> = [];
let mutationKind: 'ok' | 'purchase_rejected' = 'ok';

function reset() {
	writes = [];
	mutations = [];
	storedResponses = [];
	mutationKind = 'ok';
}

mock.module('@/core/audit', {
	namedExports: { recordAuditEvent: async () => undefined },
});
mock.module('@/core/db', {
	namedExports: { db: {}, wgInventoryItems: {} },
});
mock.module('@/core/db/idempotent-write', {
	namedExports: {
		bodyCodec: () => ({}),
		rejectWrite: (response: Response) => ({
			status: response.status,
			body: null,
			context: { rejected: response },
		}),
		withIdempotentWrite: async (
			options: { scope: string; key: string | null },
			write: (
				tx: unknown,
				input: unknown,
			) => Promise<{ status: number; body: unknown; context?: unknown }>,
		) => {
			writes.push({ scope: options.scope, key: options.key });
			const outcome = await write({}, undefined);
			if (outcome.status >= 200 && outcome.status < 300) {
				storedResponses.push({ scope: options.scope, key: options.key });
			}
			return { kind: 'written', ...outcome };
		},
	},
});
mock.module('@/core/guards/api-auth', {
	namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i },
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId },
			member: { memberId, name: 'Alex' },
		}),
	},
});
mock.module('@/core/guards/with-wg-route', {
	namedExports: {
		withWgRoute:
			(_label: string, handler: (request: Request, params: unknown) => Promise<Response>) =>
			async (request: Request, context: { params: Promise<unknown> }) =>
				handler(request, await context.params),
	},
});
mock.module('@/core/http/api-errors', {
	namedExports: {
		badRequest: (error: string) => NextResponse.json({ error }, { status: 400 }),
		conflict: (error: string) => NextResponse.json({ error }, { status: 409 }),
		notFound: (error: string) => NextResponse.json({ error }, { status: 404 }),
		payloadTooLarge: (error: string) => NextResponse.json({ error }, { status: 413 }),
		rateLimitResponse: () => null,
	},
});
mock.module('@/core/i18n/request-locale', {
	namedExports: { requestLocale: () => 'en' },
});
mock.module('@/core/idempotency-store', {
	namedExports: {
		readIdempotencyKey: (request: Request) => request.headers.get('idempotency-key'),
	},
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		wgWriteLimiter: {},
	},
});
mock.module('@/features/inventory/inventory', {
	namedExports: {
		INVENTORY_LIMITS: {
			NAME_MIN: 1,
			NAME_MAX: 100,
			QUANTITY_MIN: 0,
			QUANTITY_MAX: 10_000,
			THRESHOLD_MIN: 0,
			THRESHOLD_MAX: 10_000,
		},
	},
});
mock.module('@/features/inventory/server/inventory-duplicate', {
	namedExports: {
		isInventoryNameTaken: async () => false,
		isInventoryNameViolation: () => false,
	},
});
mock.module('@/features/inventory/server/inventory-mutations', {
	namedExports: {
		updateInventoryItemMutation: async (_tx: unknown, input: Record<string, unknown>) => {
			mutations.push(input);
			if (mutationKind === 'purchase_rejected') return { kind: 'purchase_rejected' };
			return {
				kind: 'ok',
				updated: {
					id: input.itemId,
					wgId: input.wgId,
					name: 'Dish soap',
					quantity: 2,
					threshold: 0,
					unit: 'piece',
					category: 'cleaning',
				},
				delta: 1,
				autoPushedShoppingItemId: null,
			};
		},
	},
});
mock.module('@/features/inventory/server/inventory-value-schemas', {
	namedExports: { inventoryCategorySchema: z.string(), inventoryUnitSchema: z.string() },
});

const { PATCH } = await import('./route');

function offsetSpelling(iso: string) {
	return `${new Date(Date.parse(iso) + 2 * 60 * 60 * 1000).toISOString().slice(0, -1)}+02:00`;
}

async function patch(
	body: Record<string, unknown>,
	{ itemId = itemIds[0] as string, key = 'client-generated-key' } = {},
) {
	return PATCH(
		new NextRequest(`https://example.test/api/wg/ABCD2345/inventory/${itemId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', 'idempotency-key': key },
			body: JSON.stringify(body),
		}),
		{ params: Promise.resolve({ code: 'ABCD2345', id: itemId }) },
	);
}

test('purchase restock canonicalizes its purchase key and timestamp across item IDs and client keys', async () => {
	reset();
	const boughtAt = new Date(Date.now() - 60_000).toISOString();
	const body = {
		quantityDelta: 1,
		purchase: { id: purchaseId, boughtAt: offsetSpelling(boughtAt) },
	};

	for (const [index, itemId] of itemIds.entries()) {
		const response = await patch(body, { itemId, key: `client-key-${index}` });
		assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
	}

	assert.deepEqual(writes, [
		{
			scope: `inventory-restock:${wgId}:${memberId}:${boughtAt}`,
			key: purchaseId.toLowerCase(),
		},
		{
			scope: `inventory-restock:${wgId}:${memberId}:${boughtAt}`,
			key: purchaseId.toLowerCase(),
		},
	]);
	assert.deepEqual(
		mutations.map((input) => input.purchase),
		[
			{ id: purchaseId.toLowerCase(), boughtAt },
			{ id: purchaseId.toLowerCase(), boughtAt },
		],
	);
});

test('purchase restock requires a positive delta and rejects mixed inventory edits', async () => {
	const boughtAt = new Date(Date.now() - 60_000).toISOString();
	const purchase = { id: purchaseId, boughtAt };
	const invalidBodies = [
		{ purchase },
		{ purchase, quantityDelta: 0 },
		{ purchase, quantityDelta: -1 },
		{ purchase, quantityDelta: 1, name: 'Other name' },
		{ purchase, quantityDelta: 1, quantity: 3, expectedQuantity: 2, expectedUpdatedAt: boughtAt },
		{ purchase, quantityDelta: 1, threshold: 2 },
		{ purchase, quantityDelta: 1, unit: 'piece' },
		{ purchase, quantityDelta: 1, category: 'cleaning' },
	];

	for (const body of invalidBodies) {
		reset();
		const response = await patch(body);
		assert.equal(response.status, 400);
		assert.deepEqual(writes, []);
		assert.deepEqual(mutations, []);
	}
});

test('ordinary inventory patches keep their route scope and request key', async () => {
	reset();
	const response = await patch({ quantityDelta: 1 }, { key: 'ordinary-client-key' });
	assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
	assert.deepEqual(writes, [
		{ scope: `inventory-patch:${wgId}:${memberId}:${itemIds[0]}`, key: 'ordinary-client-key' },
	]);
});

test('a rejected purchase is a non-stored conflict', async () => {
	reset();
	mutationKind = 'purchase_rejected';
	const response = await patch({
		quantityDelta: 1,
		purchase: { id: purchaseId, boughtAt: new Date(Date.now() - 60_000).toISOString() },
	});
	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), { error: 'inventory_purchase_changed' });
	assert.deepEqual(storedResponses, []);
});
