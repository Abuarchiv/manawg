import { E2E_EXISTING_WG } from '@/lib/e2e-db-down';
import { INVENTORY_LIST_LIMIT } from '@/lib/wg/inventory';
import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { MEMBER_ID_HEADER } from '@manawg/shared/lib/member-header';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 9, reset: 0 }),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: {},
	};
});

const SHARE_CODE = 'MTE8PZAT';
const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const WG_ID = 'wg-1';

describe('inventory route', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.unstubAllEnvs();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 9, reset: 0 });
	});

	it('returns field-specific validation errors when creating items', async () => {
		const { POST } = await import('./route');
		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { name: '' }, error: 'name_invalid' },
			{ body: { name: 'Klopapier', quantity: -1 }, error: 'quantity_invalid' },
			{ body: { name: 'Klopapier', threshold: -1 }, error: 'threshold_invalid' },
			{ body: { name: 'Klopapier', unit: 'Eimer' }, error: 'unit_invalid' },
			{ body: { name: 'Klopapier', category: 'garten' }, error: 'category_invalid' },
		];
		for (const testCase of cases) {
			const res = await POST(
				new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory`, {
					method: 'POST',
					body: JSON.stringify(testCase.body),
				}),
				{ params: Promise.resolve({ code: SHARE_CODE }) },
			);
			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: testCase.error });
		}
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('BUG-573: returns fixture inventory in DB-down mode without touching the database', async () => {
		vi.stubEnv('CI', 'true');
		vi.stubEnv('NEXT_PUBLIC_DB_DOWN', 'true');
		vi.stubEnv('POSTGRES_URL', '');
		vi.stubEnv('DATABASE_URL', '');

		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/inventory`, {
				headers: { [MEMBER_ID_HEADER]: E2E_EXISTING_WG.member.id },
			}),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			grouped: { bad: [], kueche: [], putzmittel: [], sonstiges: [] },
			items: [],
		});
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('creates an inventory item and records an audit event', async () => {
		const { POST } = await import('./route');
		const itemId = 'inv-1';
		routeDb.select.mockReturnValue({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([{ id: WG_ID }]),
				})),
			})),
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: CALLER_ID, name: 'Mina' },
		});
		routeDb.insert.mockReturnValue({
			values: vi.fn(() => ({
				returning: vi.fn().mockResolvedValue([
					{
						id: itemId,
						wgId: WG_ID,
						name: 'Klopapier',
						quantity: 4,
						unit: 'Rolle',
						threshold: 2,
						category: 'bad',
					},
				]),
			})),
		});

		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory`, {
				method: 'POST',
				headers: { 'x-manawg-member-id': CALLER_ID },
				body: JSON.stringify({
					name: 'Klopapier',
					quantity: 4,
					unit: 'Rolle',
					threshold: 2,
					category: 'bad',
				}),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE }) },
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { item: { id: string; name: string } };
		expect(body.item.id).toBe(itemId);
		expect(body.item.name).toBe('Klopapier');
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'inventory.created',
				entityType: 'inventory_item',
				entityId: itemId,
			}),
		);
	});

	it('returns 429 when the rate limiter rejects the call', async () => {
		const { POST } = await import('./route');
		routeDb.select.mockReturnValue({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([{ id: WG_ID }]),
				})),
			})),
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: CALLER_ID, name: 'Mina' },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0 });
		const res = await POST(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory`, {
				method: 'POST',
				headers: { 'x-manawg-member-id': CALLER_ID },
				body: JSON.stringify({ name: 'Klopapier' }),
			}),
			{ params: Promise.resolve({ code: SHARE_CODE }) },
		);
		expect(res.status).toBe(429);
	});

	it('returns the grouped item list on GET', async () => {
		const { GET } = await import('./route');
		const items = [
			{ id: 'a', name: 'Klopapier', category: 'bad', quantity: 1, threshold: 2 },
			{ id: 'b', name: 'Nudeln', category: 'kueche', quantity: 5, threshold: 2 },
		];
		let calls = 0;
		routeDb.select.mockImplementation(() => {
			calls += 1;
			if (calls === 1) {
				return {
					from: vi.fn(() => ({
						where: vi.fn(() => ({
							limit: vi.fn().mockResolvedValue([{ id: WG_ID }]),
						})),
					})),
				};
			}
			if (calls === 2) {
				return {
					from: vi.fn(() => ({
						where: vi.fn(() => ({
							orderBy: vi.fn(() => ({
								limit: vi.fn().mockResolvedValue(items),
							})),
						})),
					})),
				};
			}
			// inventory-decrements query
			return {
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([]),
				})),
			};
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: CALLER_ID, name: 'Mina' },
		});

		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory`, {
				headers: { 'x-manawg-member-id': CALLER_ID },
			}),
			{ params: Promise.resolve({ code: SHARE_CODE }) },
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: typeof items;
			grouped: Record<string, typeof items>;
		};
		expect(body.items).toHaveLength(2);
		expect(body.grouped.bad).toHaveLength(1);
		expect(body.grouped.kueche).toHaveLength(1);
	});

	it('returns only low-stock items when ?lowStock=true is passed', async () => {
		const { GET } = await import('./route');
		const items = [
			{ id: 'low', name: 'Klopapier', category: 'bad', quantity: 1, threshold: 2 },
			{ id: 'ok', name: 'Nudeln', category: 'kueche', quantity: 5, threshold: 2 },
		];
		let calls = 0;
		routeDb.select.mockImplementation(() => {
			calls += 1;
			if (calls === 1) {
				return {
					from: vi.fn(() => ({
						where: vi.fn(() => ({
							limit: vi.fn().mockResolvedValue([{ id: WG_ID }]),
						})),
					})),
				};
			}
			if (calls === 2) {
				return {
					from: vi.fn(() => ({
						where: vi.fn(() => ({
							orderBy: vi.fn(() => ({
								limit: vi.fn().mockResolvedValue(items),
							})),
						})),
					})),
				};
			}
			return {
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([]),
				})),
			};
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: CALLER_ID, name: 'Mina' },
		});

		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory?lowStock=true`, {
				headers: { 'x-manawg-member-id': CALLER_ID },
			}),
			{ params: Promise.resolve({ code: SHARE_CODE }) },
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: Array<{ id: string }> };
		expect(body.items).toHaveLength(1);
		expect(body.items[0]?.id).toBe('low');
	});

	it('caps the item list at INVENTORY_LIST_LIMIT even when the WG has more rows', async () => {
		const { GET } = await import('./route');
		const overflowItems = Array.from({ length: INVENTORY_LIST_LIMIT + 5 }, (_, i) => ({
			id: `item-${i}`,
			name: `Item ${i}`,
			category: 'sonstiges',
			quantity: 1,
			threshold: 1,
		}));
		const limitMock = vi.fn((n: number) => Promise.resolve(overflowItems.slice(0, n)));
		let calls = 0;
		routeDb.select.mockImplementation(() => {
			calls += 1;
			if (calls === 1) {
				return {
					from: vi.fn(() => ({
						where: vi.fn(() => ({
							limit: vi.fn().mockResolvedValue([{ id: WG_ID }]),
						})),
					})),
				};
			}
			if (calls === 2) {
				return {
					from: vi.fn(() => ({
						where: vi.fn(() => ({
							orderBy: vi.fn(() => ({
								limit: limitMock,
							})),
						})),
					})),
				};
			}
			return {
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([]),
				})),
			};
		});
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: CALLER_ID, name: 'Mina' },
		});

		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${SHARE_CODE}/inventory`, {
				headers: { 'x-manawg-member-id': CALLER_ID },
			}),
			{ params: Promise.resolve({ code: SHARE_CODE }) },
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: Array<{ id: string }> };
		expect(body.items).toHaveLength(INVENTORY_LIST_LIMIT);
		expect(limitMock).toHaveBeenCalledWith(INVENTORY_LIST_LIMIT);
	});
});
