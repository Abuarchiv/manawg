import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockDb } from '../../../../../../tests/support/db-mock';
import { mockDrizzle, orderRows, rowMatches } from '../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../tests/support/route-harness';

const wgId = '22222222-2222-4222-8222-222222222222';
const shoppingItems = { wgId: 'wgId', boughtAt: 'boughtAt', createdAt: 'createdAt' };

interface Row extends Record<string, unknown> {
	id: string;
	wgId: string;
	createdAt: Date;
	boughtAt: Date | null;
}
const rows: Row[] = [];

mockDrizzle();
mockObservability();
mockRateLimit();
mockWgMember({ wg: { id: wgId }, member: { memberId: 'm', name: 'Mina' } });
mockDb({
	shoppingItems,
	db: {
		select: () => ({
			from: (table: unknown) => {
				assert.equal(table, shoppingItems);
				return {
					where: (predicate: unknown) => ({
						orderBy: (...orders: unknown[]) => ({
							limit: async (limit: number) =>
								orderRows(
									rows.filter((row) => rowMatches(row, predicate)),
									orders,
								).slice(0, limit),
						}),
					}),
				};
			},
		}),
	},
});

const { GET } = await import('./route');

test('GET keeps every open item even when the bought history exceeds the list limit', async () => {
	const base = Date.parse('2026-01-01T00:00:00.000Z');
	for (let index = 0; index < 1500; index++) {
		rows.push({
			id: `bought-${index}`,
			wgId,
			createdAt: new Date(base + index * 1000),
			boughtAt: new Date(base + index * 1000 + 500),
		});
	}
	for (let index = 0; index < 3; index++) {
		rows.push({ id: `open-${index}`, wgId, createdAt: new Date(base + index * 1000), boughtAt: null });
	}
	rows.push({ id: 'other-wg', wgId: 'other', createdAt: new Date(base), boughtAt: null });

	const response = await GET(request('/api/wg/MTE8PZAT/shopping'), routeCtx());
	assert.equal(response.status, 200);
	const { items } = (await response.json()) as { items: { id: string }[] };
	const ids = items.map((item) => item.id);

	assert.deepEqual(ids.slice(0, 3), ['open-0', 'open-1', 'open-2']);
	assert.equal(ids.includes('other-wg'), false);
	const bought = ids.slice(3);
	assert.equal(bought.length, 1000);
	// Bought history is capped from the newest purchase backwards.
	assert.equal(bought[0], 'bought-1499');
	assert.equal(bought.at(-1), 'bought-500');
});
