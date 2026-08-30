import { deriveCalendarFeedToken } from '@/features/events/calendar-subscription';
import { boundParams, chainOf, resetRouteHarness, routeDb } from '@/test/route-harness';
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
	};
});

const WG_ID = '11111111-1111-4111-8111-111111111111';
const SUBSCRIPTION_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

const subscription = {
	id: SUBSCRIPTION_ID,
	wgId: WG_ID,
	tokenSeed: 'feed-seed',
	revokedAt: null,
};

const event = {
	id: EVENT_ID,
	wgId: WG_ID,
	title: 'WG-Meeting',
	description: 'Agenda',
	startsAt: new Date('2026-08-03T18:00:00.000Z'),
	endsAt: new Date('2026-08-03T18:30:00.000Z'),
	allDay: false,
	location: 'Küche',
	recurrence: 'FREQ=WEEKLY',
	createdByMemberId: null,
	createdAt: new Date('2026-07-01T10:00:00.000Z'),
	updatedAt: new Date('2026-07-20T10:00:00.000Z'),
};

function request(token: string): NextRequest {
	return new NextRequest(`https://mana.test/api/calendar/${SUBSCRIPTION_ID}/${token}`);
}

function calendarSubscriptionQuery() {
	const query = routeDb.query.calendarSubscriptions;
	if (!query) throw new Error('calendar subscription query unavailable');
	return query;
}

describe('public calendar feed route', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.useRealTimers();
	});

	it('authenticates the capability, scopes events to its WG, and expands the app recurrence', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
		const token = deriveCalendarFeedToken(SUBSCRIPTION_ID, subscription.tokenSeed);
		if (!token) throw new Error('expected feed token');
		calendarSubscriptionQuery().findFirst.mockResolvedValue(subscription);
		let eventWhere: unknown;
		routeDb.select.mockReturnValue(
			chainOf([event], {
				onWhere: (condition) => {
					eventWhere = condition;
				},
			}),
		);

		const { GET } = await import('./route');
		const response = await GET(request(token), {
			params: Promise.resolve({ id: SUBSCRIPTION_ID, token }),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/calendar');
		const body = await response.text();
		expect(body).toContain(`UID:${EVENT_ID}-0@manawg.app`);
		expect(body).toContain('DTSTART:20260803T180000Z');
		expect(body).toContain('DTSTART:20260810T180000Z');
		expect(body).toContain('LAST-MODIFIED:20260720T100000Z');
		expect(boundParams(eventWhere)).toContain(WG_ID);
	});

	it('returns the same not-found response for an invalid or revoked capability', async () => {
		const token = deriveCalendarFeedToken(SUBSCRIPTION_ID, subscription.tokenSeed);
		if (!token) throw new Error('expected feed token');
		calendarSubscriptionQuery().findFirst.mockResolvedValue({
			...subscription,
			revokedAt: new Date('2026-08-01T00:00:00.000Z'),
		});
		const { GET } = await import('./route');

		const revoked = await GET(request(token), {
			params: Promise.resolve({ id: SUBSCRIPTION_ID, token }),
		});
		const invalidToken = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
		const invalid = await GET(request(invalidToken), {
			params: Promise.resolve({ id: SUBSCRIPTION_ID, token: invalidToken }),
		});

		expect(revoked.status).toBe(404);
		expect(invalid.status).toBe(404);
		expect(routeDb.select).not.toHaveBeenCalled();
	});
});
