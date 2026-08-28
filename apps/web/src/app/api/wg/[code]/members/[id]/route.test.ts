import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SHARE_CODE = 'MTE8PZAT';
const WG_ID = 'wg-1';
const VIEWER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const VIEWER_NAME = 'Ava';
const TARGET_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_NAME = 'Ben';
const CREDITOR_ID = '22222222-2222-4222-8222-222222222222';
const CREDITOR_NAME = 'Chris';
const DEBTOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBTOR_NAME = 'Dana';
const OUTSIDER_ID = '44444444-4444-4444-8444-444444444444';
const ROUTE_BASE = `https://mana.test/api/wg/${SHARE_CODE}/members/${TARGET_ID}`;

const guardMock = vi.hoisted(() => ({
	requireWgMember: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: { name: 'write' },
}));

const debtsMock = vi.hoisted(() => ({
	computeBalances: vi.fn(),
}));

const openExpensesMock = vi.hoisted(() => ({
	loadOpenExpenses: vi.fn(),
}));

const adminMock = vi.hoisted(() => ({
	isVerifiedWgAdmin: vi.fn(),
}));

vi.mock('@/core/guards/require-wg-member', () => ({
	requireWgMember: (...args: unknown[]) => guardMock.requireWgMember(...args),
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

vi.mock('@/lib/wg/debts', () => ({
	computeBalances: (...args: unknown[]) => debtsMock.computeBalances(...args),
}));

vi.mock('@/lib/wg/open-expenses', () => ({
	loadOpenExpenses: (...args: unknown[]) => openExpensesMock.loadOpenExpenses(...args),
}));

vi.mock('@/core/guards/admin', () => ({
	isVerifiedWgAdmin: (...args: unknown[]) => adminMock.isVerifiedWgAdmin(...args),
}));

/**
 * Feeds the route's `db.select(...)` calls one response array per invocation, in
 * order. The Proxy covers both terminal shapes the route uses: `.where().limit(1)`
 * (the target member lookup) and an awaited `.where()` (the roster lookup for
 * name resolution).
 */
function mockSelectResponses(...responses: unknown[][]): void {
	let index = 0;
	routeDb.select.mockImplementation(() => ({
		from: () => {
			let consumed = false;
			const consumeOnce = (): unknown[] => {
				if (consumed) return [];
				consumed = true;
				return responses[index++] ?? [];
			};
			const limitFn = async (): Promise<unknown[]> => consumeOnce();
			const whereResult = new Proxy(limitFn, {
				get(_target, prop) {
					if (prop === 'limit') return limitFn;
					if (prop === 'then') {
						return (resolve: (value: unknown[]) => unknown) =>
							Promise.resolve(consumeOnce()).then(resolve);
					}
					return undefined;
				},
			});
			return { where: () => whereResult };
		},
	}));
}

function mockUpdateReturning(row: Record<string, unknown>): void {
	routeDb.update.mockReturnValue({
		set: () => ({
			where: () => ({
				returning: async () => [row],
			}),
		}),
	});
}

function patchRequest(body: unknown): NextRequest {
	return new NextRequest(ROUTE_BASE, {
		method: 'PATCH',
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
}

function ctxFor(id: string) {
	return { params: Promise.resolve({ code: SHARE_CODE, id }) };
}

describe('members/[id] route', () => {
	beforeEach(() => {
		resetRouteHarness();
		guardMock.requireWgMember.mockResolvedValue({
			ok: true,
			wg: { id: WG_ID },
			member: { memberId: VIEWER_ID, name: VIEWER_NAME, verified: true },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		debtsMock.computeBalances.mockReturnValue([]);
		openExpensesMock.loadOpenExpenses.mockResolvedValue([]);
		// Cross-member PATCH tests below act as "the verified WG admin manages a
		// flatmate's status" by default; the not-an-admin case overrides this.
		adminMock.isVerifiedWgAdmin.mockResolvedValue(true);
	});

	describe('GET', () => {
		it('rejects a malformed member id before touching the database', async () => {
			const { GET } = await import('./route');

			const res = await GET(
				new NextRequest(ROUTE_BASE.replace(TARGET_ID, 'not-a-uuid')),
				ctxFor('not-a-uuid'),
			);

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: 'id_invalid' });
			expect(routeDb.select).not.toHaveBeenCalled();
		});

		it('returns 404 when the member is not in this WG', async () => {
			const { GET } = await import('./route');
			mockSelectResponses([]);

			const res = await GET(new NextRequest(ROUTE_BASE), ctxFor(TARGET_ID));

			expect(res.status).toBe(404);
			await expect(res.json()).resolves.toEqual({ error: 'member_not_found' });
		});

		it('reports an active member with no open balances', async () => {
			const { GET } = await import('./route');
			mockSelectResponses([{ id: TARGET_ID, name: TARGET_NAME, deactivatedAt: null }]);

			const res = await GET(new NextRequest(ROUTE_BASE), ctxFor(TARGET_ID));

			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({
				member: { id: TARGET_ID, name: TARGET_NAME, active: true },
				openBalances: [],
			});
		});

		it('marks a member with a deactivation timestamp as inactive', async () => {
			const { GET } = await import('./route');
			mockSelectResponses([
				{ id: TARGET_ID, name: TARGET_NAME, deactivatedAt: new Date('2026-07-01T00:00:00.000Z') },
			]);

			const res = await GET(new NextRequest(ROUTE_BASE), ctxFor(TARGET_ID));

			const body = (await res.json()) as { member: { active: boolean } };
			expect(body.member.active).toBe(false);
		});

		it('lists open balances from the member perspective, sorted by amount desc', async () => {
			const { GET } = await import('./route');
			// One pair where the target owes (debtor), one where it is owed (creditor),
			// and one unrelated pair that must be filtered out.
			debtsMock.computeBalances.mockReturnValue([
				{ debtorId: TARGET_ID, creditorId: CREDITOR_ID, amountCents: 500 },
				{ debtorId: DEBTOR_ID, creditorId: TARGET_ID, amountCents: 1200 },
				{ debtorId: OUTSIDER_ID, creditorId: DEBTOR_ID, amountCents: 999 },
			]);
			mockSelectResponses(
				[{ id: TARGET_ID, name: TARGET_NAME, deactivatedAt: null }],
				[
					{ id: CREDITOR_ID, name: CREDITOR_NAME },
					{ id: DEBTOR_ID, name: DEBTOR_NAME },
					{ id: TARGET_ID, name: TARGET_NAME },
				],
			);

			const res = await GET(new NextRequest(ROUTE_BASE), ctxFor(TARGET_ID));

			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({
				member: { id: TARGET_ID, name: TARGET_NAME, active: true },
				openBalances: [
					{ member_id: DEBTOR_ID, name: DEBTOR_NAME, amount_cents: 1200, direction: 'owed' },
					{ member_id: CREDITOR_ID, name: CREDITOR_NAME, amount_cents: 500, direction: 'owes' },
				],
			});
		});

		it('falls back to "Unbekannt" when a counterparty is missing from the roster', async () => {
			const { GET } = await import('./route');
			debtsMock.computeBalances.mockReturnValue([
				{ debtorId: TARGET_ID, creditorId: CREDITOR_ID, amountCents: 700 },
			]);
			mockSelectResponses(
				[{ id: TARGET_ID, name: TARGET_NAME, deactivatedAt: null }],
				[{ id: TARGET_ID, name: TARGET_NAME }],
			);

			const res = await GET(new NextRequest(ROUTE_BASE), ctxFor(TARGET_ID));

			const body = (await res.json()) as { openBalances: Array<{ name: string }> };
			expect(body.openBalances[0]?.name).toBe('Unbekannt');
		});
	});

	describe('PATCH', () => {
		it('rejects a malformed member id', async () => {
			const { PATCH } = await import('./route');

			const res = await PATCH(patchRequest({ active: false }), ctxFor('not-a-uuid'));

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: 'id_invalid' });
		});

		it('rejects a body without a boolean active flag', async () => {
			const { PATCH } = await import('./route');

			const res = await PATCH(patchRequest({ active: 'yes' }), ctxFor(TARGET_ID));

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: 'active_invalid' });
			expect(guardMock.requireWgMember).not.toHaveBeenCalled();
			expect(routeDb.select).not.toHaveBeenCalled();
		});

		it('rejects a malformed JSON body', async () => {
			const { PATCH } = await import('./route');

			const res = await PATCH(patchRequest('{ not json'), ctxFor(TARGET_ID));

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: 'invalid_json' });
		});

		it('returns 429 when the write rate limit is exceeded, before any lookup', async () => {
			const { PATCH } = await import('./route');
			rateLimitMock.checkRateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0 });

			const res = await PATCH(patchRequest({ active: false }), ctxFor(TARGET_ID));

			expect(res.status).toBe(429);
			expect(routeDb.select).not.toHaveBeenCalled();
		});

		it('returns 404 when patching a member not in this WG', async () => {
			const { PATCH } = await import('./route');
			mockSelectResponses([]);

			const res = await PATCH(patchRequest({ active: false }), ctxFor(TARGET_ID));

			expect(res.status).toBe(404);
			await expect(res.json()).resolves.toEqual({ error: 'member_not_found' });
			expect(routeDb.update).not.toHaveBeenCalled();
		});

		it('deactivates an active member and records a deactivation audit event', async () => {
			const { PATCH } = await import('./route');
			mockSelectResponses([{ id: TARGET_ID, name: TARGET_NAME, deactivatedAt: null }]);
			mockUpdateReturning({
				id: TARGET_ID,
				name: TARGET_NAME,
				deactivatedAt: new Date('2026-07-25T09:00:00.000Z'),
			});

			const res = await PATCH(patchRequest({ active: false }), ctxFor(TARGET_ID));

			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({
				member: { id: TARGET_ID, name: TARGET_NAME, active: false },
			});
			expect(routeDb.update).toHaveBeenCalledTimes(1);
			expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					wgId: WG_ID,
					memberId: VIEWER_ID,
					eventType: 'member.deactivated',
					entityType: 'member',
					entityId: TARGET_ID,
				}),
			);
		});

		it('reactivates a deactivated member and records a reactivation audit event', async () => {
			const { PATCH } = await import('./route');
			mockSelectResponses([
				{ id: TARGET_ID, name: TARGET_NAME, deactivatedAt: new Date('2026-07-01T00:00:00.000Z') },
			]);
			mockUpdateReturning({ id: TARGET_ID, name: TARGET_NAME, deactivatedAt: null });

			const res = await PATCH(patchRequest({ active: true }), ctxFor(TARGET_ID));

			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({
				member: { id: TARGET_ID, name: TARGET_NAME, active: true },
			});
			expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
				expect.objectContaining({ eventType: 'member.reactivated', entityId: TARGET_ID }),
			);
		});

		it('is idempotent: skips the write and audit when already in the requested state', async () => {
			const { PATCH } = await import('./route');
			mockSelectResponses([
				{ id: TARGET_ID, name: TARGET_NAME, deactivatedAt: new Date('2026-07-01T00:00:00.000Z') },
			]);

			const res = await PATCH(patchRequest({ active: false }), ctxFor(TARGET_ID));

			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({
				member: { id: TARGET_ID, name: TARGET_NAME, active: false },
			});
			expect(routeDb.update).not.toHaveBeenCalled();
			expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
		});

		it('rejects deactivating another member when the caller is not a verified admin', async () => {
			const { PATCH } = await import('./route');
			adminMock.isVerifiedWgAdmin.mockResolvedValue(false);
			mockSelectResponses([{ id: TARGET_ID, name: TARGET_NAME, deactivatedAt: null }]);

			const res = await PATCH(patchRequest({ active: false }), ctxFor(TARGET_ID));

			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'not_owner', code: 'not_owner' });
			expect(routeDb.update).not.toHaveBeenCalled();
			expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
			expect(adminMock.isVerifiedWgAdmin).toHaveBeenCalledWith(WG_ID, VIEWER_ID, true);
		});

		it('allows a member to deactivate themselves even without admin verification', async () => {
			const { PATCH } = await import('./route');
			adminMock.isVerifiedWgAdmin.mockResolvedValue(false);
			mockSelectResponses([{ id: VIEWER_ID, name: VIEWER_NAME, deactivatedAt: null }]);
			mockUpdateReturning({
				id: VIEWER_ID,
				name: VIEWER_NAME,
				deactivatedAt: new Date('2026-07-25T09:00:00.000Z'),
			});

			const res = await PATCH(patchRequest({ active: false }), ctxFor(VIEWER_ID));

			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({
				member: { id: VIEWER_ID, name: VIEWER_NAME, active: false },
			});
			expect(routeDb.update).toHaveBeenCalledTimes(1);
		});
	});
});
