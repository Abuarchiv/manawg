import { E2E_EXISTING_WG } from '@/lib/e2e-db-down';
import { EVENTS_LIST_LIMIT } from '@/lib/wg/events';
import { boundParams, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { MEMBER_ID_HEADER } from '@manawg/shared/lib/member-header';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgReadLimiter: { name: 'wgReadLimiter' },
		wgWriteLimiter: { name: 'wgWriteLimiter' },
	};
});

function mockSelectResponses(...responses: unknown[][]): void {
	let index = 0;
	routeDb.select.mockImplementation(() => ({
		from: () => ({
			where: () => ({
				limit: async () => responses[index++] ?? [],
				orderBy: () => ({
					limit: async () => responses[index++] ?? [],
				}),
			}),
		}),
	}));
}

const MEMBER = { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Ava' };

describe('events route', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.unstubAllEnvs();
		routeMocks.requireMember.mockResolvedValue({ ok: true, member: MEMBER });
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		routeMocks.dispatchNotification.mockResolvedValue(undefined);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: -1, reset: 0 });
	});

	it('rejects an unknown share code', async () => {
		const { GET } = await import('./route');
		const res = await GET(new NextRequest('https://mana.test/api/wg/INVALID/events'), {
			params: Promise.resolve({ code: 'INVALID' }),
		});
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'invalid_share_code' });
	});

	it('BUG-572: returns fixture events in DB-down mode without touching the database', async () => {
		vi.stubEnv('CI', 'true');
		vi.stubEnv('NEXT_PUBLIC_DB_DOWN', 'true');
		vi.stubEnv('POSTGRES_URL', '');
		vi.stubEnv('DATABASE_URL', '');

		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/events`, {
				headers: { [MEMBER_ID_HEADER]: E2E_EXISTING_WG.member.id },
			}),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ events: [] });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('returns events list for a valid WG', async () => {
		const wgId = '11111111-1111-1111-1111-111111111111';
		const startsAt = new Date('2026-06-01T08:00:00.000Z');
		const row = {
			id: '22222222-2222-2222-2222-222222222222',
			wgId,
			title: 'Heizungsablesung',
			description: null,
			startsAt,
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
			createdByMemberId: MEMBER.memberId,
			createdAt: startsAt,
			updatedAt: startsAt,
		};
		mockSelectResponses([{ id: wgId, name: 'Test WG' }], [row]);

		const { GET } = await import('./route');
		const res = await GET(new NextRequest('https://mana.test/api/wg/MTE8PZAT/events'), {
			params: Promise.resolve({ code: 'MTE8PZAT' }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.events).toHaveLength(1);
		expect(body.events[0]).toMatchObject({
			id: row.id,
			title: 'Heizungsablesung',
			startsAt: startsAt.toISOString(),
		});
	});

	it('caps the events list at EVENTS_LIST_LIMIT even when the WG has more rows', async () => {
		const wgId = '11111111-1111-1111-1111-111111111111';
		const startsAt = new Date('2026-06-01T08:00:00.000Z');
		const overflowRows = Array.from({ length: EVENTS_LIST_LIMIT + 5 }, (_, i) => ({
			id: `${`${i}`.padStart(8, '0')}-0000-0000-0000-000000000000`,
			wgId,
			title: `Event ${i}`,
			description: null,
			startsAt,
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
			createdByMemberId: MEMBER.memberId,
			createdAt: startsAt,
			updatedAt: startsAt,
		}));
		const limitMock = vi.fn((n: number) => Promise.resolve(overflowRows.slice(0, n)));
		let calls = 0;
		routeDb.select.mockImplementation(() => {
			calls += 1;
			if (calls === 1) {
				return {
					from: () => ({
						where: () => ({
							limit: async () => [{ id: wgId, name: 'Test WG' }],
						}),
					}),
				};
			}
			return {
				from: () => ({
					where: () => ({
						orderBy: () => ({
							limit: limitMock,
						}),
					}),
				}),
			};
		});

		const { GET } = await import('./route');
		const res = await GET(new NextRequest('https://mana.test/api/wg/MTE8PZAT/events'), {
			params: Promise.resolve({ code: 'MTE8PZAT' }),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.events).toHaveLength(EVENTS_LIST_LIMIT);
		expect(limitMock).toHaveBeenCalledWith(EVENTS_LIST_LIMIT);
	});

	it('RED BUG-019: bounds recurring event lookup by the requested from date', async () => {
		const wgId = '11111111-1111-1111-1111-111111111111';
		let whereArg: unknown;
		let selectIndex = 0;
		routeDb.select.mockImplementation(() => ({
			from: () => ({
				where: (arg: unknown) => {
					selectIndex += 1;
					if (selectIndex === 1) {
						return {
							limit: async () => [{ id: wgId, name: 'Test WG' }],
						};
					}
					whereArg = arg;
					return {
						orderBy: () => ({
							limit: async () => [],
						}),
					};
				},
			}),
		}));

		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest(
				'https://mana.test/api/wg/MTE8PZAT/events?from=2026-06-01T00:00:00.000Z&to=2026-06-30T23:59:59.999Z',
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		// The recurring lookup must start at the requested `from`, not at the
		// epoch — the latter scans every recurring event ever created.
		expect(boundParams(whereArg)).not.toContainEqual(new Date('1970-01-01T00:00:00.000Z'));
	});

	it('returns field-specific validation errors when creating events', async () => {
		const { POST } = await import('./route');
		const valid = {
			title: 'Standup',
			startsAt: '2026-06-01T08:00:00.000Z',
		};
		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { ...valid, title: '' }, error: 'title_invalid' },
			{ body: { ...valid, startsAt: 'morgen' }, error: 'starts_at_invalid' },
			{ body: { ...valid, endsAt: 'morgen' }, error: 'ends_at_invalid' },
			{ body: { ...valid, recurrence: 'FREQ=HOURLY' }, error: 'recurrence_invalid' },
		];
		for (const testCase of cases) {
			const res = await POST(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT/events', {
					method: 'POST',
					body: JSON.stringify(testCase.body),
				}),
				{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
			);
			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: testCase.error });
		}
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('creates a new event and records an audit entry', async () => {
		const wgId = '11111111-1111-1111-1111-111111111111';
		const createdRow = {
			id: '33333333-3333-3333-3333-333333333333',
			wgId,
			title: 'Heizungsablesung',
			description: null,
			startsAt: new Date('2026-06-01T08:00:00.000Z'),
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: 'FREQ=YEARLY',
			createdByMemberId: MEMBER.memberId,
			createdAt: new Date('2026-05-24T00:00:00.000Z'),
			updatedAt: new Date('2026-05-24T00:00:00.000Z'),
		};
		mockSelectResponses([{ id: wgId, name: 'Test WG' }]);
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [createdRow],
			}),
		});

		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/events', {
				method: 'POST',
				body: JSON.stringify({
					title: 'Heizungsablesung',
					startsAt: '2026-06-01T08:00:00.000Z',
					recurrence: 'FREQ=YEARLY',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.event.id).toBe(createdRow.id);
		expect(body.event.recurrence).toBe('FREQ=YEARLY');
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'event.created',
				entityId: createdRow.id,
				memberId: MEMBER.memberId,
			}),
		);
	});

	it('RED BUG-207-EVENTS: rate-limits event creation by WG and member, not spoofable IP only', async () => {
		const wgId = '11111111-1111-1111-1111-111111111111';
		const createdRow = {
			id: '33333333-3333-3333-3333-333333333333',
			wgId,
			title: 'Heizungsablesung',
			description: null,
			startsAt: new Date('2026-06-01T08:00:00.000Z'),
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
			createdByMemberId: MEMBER.memberId,
			createdAt: new Date('2026-05-24T00:00:00.000Z'),
			updatedAt: new Date('2026-05-24T00:00:00.000Z'),
		};
		mockSelectResponses([{ id: wgId, name: 'Test WG' }]);
		routeDb.insert.mockReturnValue({
			values: () => ({
				returning: async () => [createdRow],
			}),
		});

		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/events', {
				method: 'POST',
				headers: { 'x-forwarded-for': '198.51.100.66, 203.0.113.10' },
				body: JSON.stringify({
					title: 'Heizungsablesung',
					startsAt: '2026-06-01T08:00:00.000Z',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			expect.anything(),
			`events:${wgId}:${MEMBER.memberId}`,
		);
	});

	it('rejects events whose end is before the start', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/events', {
				method: 'POST',
				body: JSON.stringify({
					title: 'X',
					startsAt: '2026-06-01T10:00:00.000Z',
					endsAt: '2026-06-01T09:00:00.000Z',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'ends_before_start' });
	});
});
