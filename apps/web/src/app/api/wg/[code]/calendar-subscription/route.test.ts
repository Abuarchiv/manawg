import { deriveCalendarFeedToken } from '@/features/events/calendar-subscription';
import { authenticateAs, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgReadLimiter: { name: 'wgReadLimiter' },
		wgWriteLimiter: { name: 'wgWriteLimiter' },
	};
});

const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const WG_ID = '11111111-1111-4111-8111-111111111111';
const SUBSCRIPTION_ID = '22222222-2222-4222-8222-222222222222';

function row(seed = 'seed') {
	return {
		id: SUBSCRIPTION_ID,
		wgId: WG_ID,
		memberId: MEMBER_ID,
		tokenSeed: seed,
		revokedAt: null,
		createdAt: new Date('2026-08-01T10:00:00.000Z'),
		updatedAt: new Date('2026-08-02T10:00:00.000Z'),
	};
}

function request(method = 'GET'): NextRequest {
	return new NextRequest('https://mana.test/api/wg/MTE8PZAT/calendar-subscription', { method });
}

describe('calendar subscription route', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
		authenticateAs(MEMBER_ID, { wg: { id: WG_ID, name: 'Test WG', shareCode: 'MTE8PZAT' } });
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
	});

	afterEach(() => vi.unstubAllEnvs());

	it('only exposes the current URL to a verified member', async () => {
		routeDb.query.calendarSubscriptions!.findFirst.mockResolvedValue(row());
		const { GET } = await import('./route');

		const res = await GET(request(), { params: Promise.resolve({ code: 'MTE8PZAT' }) });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.subscription.feedUrl).toContain(`/api/calendar/${SUBSCRIPTION_ID}/`);
		expect(body.subscription.feedUrl).toContain(deriveCalendarFeedToken(SUBSCRIPTION_ID, 'seed'));

		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: MEMBER_ID, name: 'Mina', verified: false },
		});
		const denied = await GET(request(), { params: Promise.resolve({ code: 'MTE8PZAT' }) });
		expect(denied.status).toBe(403);
	});

	it('creates a member-scoped feed and records an audit entry', async () => {
		const created = row('created-seed');
		routeDb.query.calendarSubscriptions!.findFirst.mockResolvedValue(undefined);
		routeDb.insert.mockReturnValue({
			values: (values: Record<string, unknown>) => {
				expect(values).toMatchObject({ wgId: WG_ID, memberId: MEMBER_ID });
				return { returning: async () => [created] };
			},
		});
		const { POST } = await import('./route');

		const res = await POST(request('POST'), { params: Promise.resolve({ code: 'MTE8PZAT' }) });
		expect(res.status).toBe(200);
		expect((await res.json()).subscription.feedUrl).toContain(
			deriveCalendarFeedToken(SUBSCRIPTION_ID, 'created-seed'),
		);
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'calendar.feed_created', entityId: SUBSCRIPTION_ID }),
		);
	});

	it('rotates the capability and revokes it with WG and member scope', async () => {
		const rotated = row('rotated-seed');
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({ returning: async () => [rotated] }),
			}),
		});
		const { PATCH, DELETE } = await import('./route');

		const rotatedResponse = await PATCH(request('PATCH'), {
			params: Promise.resolve({ code: 'MTE8PZAT' }),
		});
		expect(rotatedResponse.status).toBe(200);
		expect((await rotatedResponse.json()).subscription.feedUrl).toContain(
			deriveCalendarFeedToken(SUBSCRIPTION_ID, 'rotated-seed'),
		);

		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({ returning: async () => [{ id: SUBSCRIPTION_ID }] }),
			}),
		});
		const revokedResponse = await DELETE(request('DELETE'), {
			params: Promise.resolve({ code: 'MTE8PZAT' }),
		});
		expect(revokedResponse.status).toBe(200);
		await expect(revokedResponse.json()).resolves.toEqual({ revoked: true });
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'calendar.feed_revoked' }),
		);
	});
});
