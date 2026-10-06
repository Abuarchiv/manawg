import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockDb } from '../../../../../../tests/support/db-mock';
import {
	mockDrizzle,
	orderRows,
	project,
	rowMatches,
} from '../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../tests/support/route-harness';

const wgId = '22222222-2222-4222-8222-222222222222';
const shoppingItems = { wgId: 'wgId', boughtAt: 'boughtAt', createdAt: 'createdAt' };
const wgMembers = { id: 'id', wgId: 'wgId', role: 'role', deactivatedAt: 'deactivatedAt' };
const members = [
	{ id: 'm', wgId, role: 'member', deactivatedAt: null },
	{ id: 'admin', wgId, role: 'admin', deactivatedAt: null },
];
const deletes: unknown[] = [];

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
const member = mockWgMember({ wg: { id: wgId }, member: { memberId: 'm', name: 'Mina' } });
mockDb({
	shoppingItems,
	wgMembers,
	db: {
		delete: (table: unknown) => {
			deletes.push(table);
			return { where: () => ({ returning: async () => [] }) };
		},
		select: (fields: Record<string, unknown>) => ({
			from: (table: unknown) => {
				if (table === wgMembers) {
					return {
						where: (predicate: unknown) => ({
							limit: async (limit: number) =>
								project(
									members.filter((row) => rowMatches(row, predicate)),
									fields,
								).slice(0, limit),
						}),
					};
				}
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

const { DELETE, GET } = await import('./route');

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
		rows.push({
			id: `open-${index}`,
			wgId,
			createdAt: new Date(base + index * 1000),
			boughtAt: null,
		});
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

test('clearing bought items is refused for a member without the WG admin role', async () => {
	deletes.length = 0;
	member.member = { memberId: 'm', name: 'Mina' };
	const refused = await DELETE(
		request('/api/wg/MTE8PZAT/shopping', { method: 'DELETE' }),
		routeCtx(),
	);
	assert.equal(refused.status, 403);
	assert.deepEqual(await refused.json(), { error: 'not_admin', code: 'not_admin' });
	assert.deepEqual(deletes, []);

	member.member = { memberId: 'admin', name: 'Ada' };
	const cleared = await DELETE(
		request('/api/wg/MTE8PZAT/shopping', { method: 'DELETE' }),
		routeCtx(),
	);
	assert.equal(cleared.status, 200);
	assert.deepEqual(await cleared.json(), { deleted: 0 });
	assert.deepEqual(deletes, [shoppingItems]);
});
