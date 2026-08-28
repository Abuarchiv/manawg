import { chainOf, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reminderClaimMock = vi.hoisted(() => ({
	seen: new Set<string>(),
}));

const CRON_SECRET = 'test-secret';
const AUTH_HEADER = { authorization: `Bearer ${CRON_SECRET}` };

function buildTomorrowAt(hour: number, minute = 0): Date {
	const d = new Date();
	d.setDate(d.getDate() + 1);
	d.setHours(hour, minute, 0, 0);
	return d;
}

describe('event reminders cron route', () => {
	beforeEach(() => {
		resetRouteHarness();
		reminderClaimMock.seen.clear();
		vi.unstubAllEnvs();
		routeDb.insert.mockImplementation(() => ({
			values: vi.fn((value: { scope: string; key: string }) => ({
				onConflictDoNothing: vi.fn(() => ({
					returning: vi.fn(async () => {
						const claimKey = `${value.scope}:${value.key}`;
						if (reminderClaimMock.seen.has(claimKey)) return [];
						reminderClaimMock.seen.add(claimKey);
						return [{ key: value.key }];
					}),
				})),
			})),
		}));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns 503 when CRON_SECRET is missing', async () => {
		const { GET } = await import('./route');
		const res = await GET(new NextRequest('https://mana.test/api/cron/event-reminders'));
		expect(res.status).toBe(503);
	});

	it('returns 401 when Bearer is missing', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		const { GET } = await import('./route');
		const res = await GET(new NextRequest('https://mana.test/api/cron/event-reminders'));
		expect(res.status).toBe(401);
	});

	it('dispatches an event.upcoming notification for events starting tomorrow', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-28T12:00:00.000Z'));
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		const tomorrow = buildTomorrowAt(10);
		routeDb.select.mockReturnValueOnce(
			chainOf([
				{
					id: 'evt-1',
					title: 'Heizungsablesung',
					description: null,
					startsAt: tomorrow,
					endsAt: null,
					allDay: false,
					location: null,
					recurrence: null,
					wgId: 'wg-1',
					wgName: 'Test WG',
					shareCode: 'MTE8PZAT',
				},
			]),
		);
		routeMocks.dispatchNotification.mockResolvedValue({ sent: 1 });

		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest('https://mana.test/api/cron/event-reminders', { headers: AUTH_HEADER }),
		);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, sent: 1 });
		expect(routeMocks.dispatchNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'event.upcoming',
				payload: expect.objectContaining({ eventId: 'evt-1' }),
			}),
		);
	});

	it('computes horizonStart via UTC year subtraction (stable across calendar years)', async () => {
		const { computeHorizonStart } = await import('@/lib/wg/event-reminder-window');
		const nonLeap = new Date(Date.UTC(2026, 4, 24, 12, 0, 0));
		const horizon = computeHorizonStart(nonLeap);
		expect(horizon.getUTCFullYear()).toBe(2024);
		expect(horizon.getUTCMonth()).toBe(4);
		expect(horizon.getUTCDate()).toBe(24);

		// Same UTC calendar-date span for any input — verifies we don't
		// use the buggy `now - 2*365*MS_PER_DAY` (which shifts by 1 or 2
		// days for inputs that cross 1 or 2 leap days respectively).
		const yearLater = new Date(Date.UTC(2027, 4, 24, 12, 0, 0));
		const horizonYearLater = computeHorizonStart(yearLater);
		expect(horizonYearLater.getUTCFullYear()).toBe(2025);
		expect(horizonYearLater.getUTCMonth()).toBe(4);
		expect(horizonYearLater.getUTCDate()).toBe(24);

		const badDelta = (yearLater.getTime() - nonLeap.getTime()) % (24 * 60 * 60 * 1000);
		expect(badDelta).toBe(0);
		const goodDelta = horizonYearLater.getTime() - horizon.getTime();
		expect(goodDelta % (24 * 60 * 60 * 1000)).toBe(0);
		expect(goodDelta).toBeGreaterThanOrEqual(365 * 24 * 60 * 60 * 1000);
	});

	it('computes the reminder tomorrow window on Berlin calendar days', async () => {
		const { computeTomorrowUtcWindow } = await import('@/lib/wg/event-reminder-window');
		// Summer (CEST, UTC+2): Berlin midnight = 22:00 UTC of the previous day.
		const summer = computeTomorrowUtcWindow(new Date('2026-05-24T22:30:00.000Z'));
		expect(summer.start.toISOString()).toBe('2026-05-25T22:00:00.000Z');
		expect(summer.end.toISOString()).toBe('2026-05-26T21:59:59.999Z');

		// Winter (CET, UTC+1): Berlin midnight = 23:00 UTC.
		const winter = computeTomorrowUtcWindow(new Date('2026-01-20T22:30:00.000Z'));
		expect(winter.start.toISOString()).toBe('2026-01-20T23:00:00.000Z');
		expect(winter.end.toISOString()).toBe('2026-01-21T22:59:59.999Z');
	});

	it('skips when there are no events', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		routeDb.select.mockReturnValueOnce(chainOf([]));
		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest('https://mana.test/api/cron/event-reminders', { headers: AUTH_HEADER }),
		);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, sent: 0 });
	});

	it('RED BUG-124: does not dispatch the same event reminder twice across cron retries', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-28T12:00:00.000Z'));
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		const tomorrow = buildTomorrowAt(10);
		const dueRow = {
			id: 'evt-1',
			title: 'Heizungsablesung',
			description: null,
			startsAt: tomorrow,
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
			wgId: 'wg-1',
			wgName: 'Test WG',
			shareCode: 'MTE8PZAT',
		};
		routeDb.select.mockReturnValueOnce(chainOf([dueRow])).mockReturnValueOnce(chainOf([dueRow]));
		routeMocks.dispatchNotification.mockResolvedValue({ sent: 1 });

		const { GET } = await import('./route');
		const first = await GET(
			new NextRequest('https://mana.test/api/cron/event-reminders', { headers: AUTH_HEADER }),
		);
		const retry = await GET(
			new NextRequest('https://mana.test/api/cron/event-reminders', { headers: AUTH_HEADER }),
		);

		expect(first.status).toBe(200);
		expect(retry.status).toBe(200);
		expect(routeMocks.dispatchNotification).toHaveBeenCalledTimes(1);
		await expect(retry.json()).resolves.toEqual({ ok: true, sent: 0 });
	});
});
