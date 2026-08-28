import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminMock = vi.hoisted(() => ({
	isVerifiedWgAdmin: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgReadLimiter: { kind: 'read' },
	wgWriteLimiter: { kind: 'write' },
}));

vi.mock('@/core/guards/admin', () => ({
	isVerifiedWgAdmin: (...args: unknown[]) => adminMock.isVerifiedWgAdmin(...args),
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgReadLimiter: rateLimitMock.wgReadLimiter,
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

function mockSelectResponses(...responses: unknown[][]): void {
	let index = 0;
	routeDb.select.mockImplementation(() => ({
		from: () => ({
			where: () => ({
				limit: async () => responses[index++] ?? [],
			}),
		}),
	}));
}

const MEMBER = { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Ava', verified: true };
const EVENT_ID = '44444444-4444-4444-4444-444444444444';

describe('events [id] route', () => {
	beforeEach(() => {
		resetRouteHarness();
		routeMocks.requireMember.mockResolvedValue({ ok: true, member: MEMBER });
		adminMock.isVerifiedWgAdmin.mockResolvedValue(false);
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: -1, reset: 0 });
	});

	it('returns id_invalid for a malformed id', async () => {
		const { DELETE } = await import('./route');
		const res = await DELETE(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/events/abc', { method: 'DELETE' }),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: 'abc' }) },
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'id_invalid' });
	});

	it('returns event_not_found when the event does not exist', async () => {
		mockSelectResponses([{ id: 'wg-1' }], []);
		const { DELETE } = await import('./route');
		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/events/${EVENT_ID}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: EVENT_ID }) },
		);
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: 'event_not_found' });
	});

	it('updates an event and records audit', async () => {
		const updatedRow = {
			id: EVENT_ID,
			wgId: 'wg-1',
			title: 'Heizungsablesung 2026',
			description: null,
			startsAt: new Date('2026-06-01T08:00:00.000Z'),
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
			createdByMemberId: MEMBER.memberId,
			createdAt: new Date('2026-05-24T00:00:00.000Z'),
			updatedAt: new Date('2026-05-25T00:00:00.000Z'),
		};
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[
				{
					createdByMemberId: MEMBER.memberId,
					startsAt: new Date('2026-06-01T08:00:00.000Z'),
					endsAt: null,
				},
			],
		);
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [updatedRow],
				}),
			}),
		});
		const { PATCH } = await import('./route');
		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/events/${EVENT_ID}`, {
				method: 'PATCH',
				body: JSON.stringify({ title: 'Heizungsablesung 2026' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: EVENT_ID }) },
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.event.title).toBe('Heizungsablesung 2026');
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'event.updated', entityId: EVENT_ID }),
		);
	});

	it('RED BUG-207-EVENT-ITEM: rate-limits event updates by WG and member, not spoofable IP only', async () => {
		const updatedRow = {
			id: EVENT_ID,
			wgId: 'wg-1',
			title: 'Heizungsablesung 2026',
			description: null,
			startsAt: new Date('2026-06-01T08:00:00.000Z'),
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: null,
			createdByMemberId: MEMBER.memberId,
			createdAt: new Date('2026-05-24T00:00:00.000Z'),
			updatedAt: new Date('2026-05-25T00:00:00.000Z'),
		};
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[
				{
					createdByMemberId: MEMBER.memberId,
					startsAt: new Date('2026-06-01T08:00:00.000Z'),
					endsAt: null,
				},
			],
		);
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [updatedRow],
				}),
			}),
		});

		const { PATCH } = await import('./route');
		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/events/${EVENT_ID}`, {
				method: 'PATCH',
				headers: { 'x-forwarded-for': '198.51.100.66, 203.0.113.10' },
				body: JSON.stringify({ title: 'Heizungsablesung 2026' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: EVENT_ID }) },
		);

		expect(res.status).toBe(200);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			expect.anything(),
			`events:item:wg-1:${MEMBER.memberId}`,
		);
	});

	it('rejects PATCH when a new end would be before the existing start', async () => {
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[
				{
					createdByMemberId: MEMBER.memberId,
					startsAt: new Date('2026-06-01T10:00:00.000Z'),
					endsAt: null,
				},
			],
		);
		const { PATCH } = await import('./route');
		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/events/${EVENT_ID}`, {
				method: 'PATCH',
				body: JSON.stringify({ endsAt: '2026-06-01T09:00:00.000Z' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: EVENT_ID }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'ends_before_start' });
		expect(routeDb.update).not.toHaveBeenCalled();
	});

	it('rejects PATCH when a new start would be after the existing end', async () => {
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[
				{
					createdByMemberId: MEMBER.memberId,
					startsAt: new Date('2026-06-01T08:00:00.000Z'),
					endsAt: new Date('2026-06-01T09:00:00.000Z'),
				},
			],
		);
		const { PATCH } = await import('./route');
		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/events/${EVENT_ID}`, {
				method: 'PATCH',
				body: JSON.stringify({ startsAt: '2026-06-01T10:00:00.000Z' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: EVENT_ID }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'ends_before_start' });
		expect(routeDb.update).not.toHaveBeenCalled();
	});

	it('deletes an event and records audit', async () => {
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[{ title: 'Standup', createdByMemberId: MEMBER.memberId }],
		);
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: EVENT_ID }],
			}),
		});
		const { DELETE } = await import('./route');
		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/events/${EVENT_ID}`, {
				method: 'DELETE',
				headers: { 'x-forwarded-for': '198.51.100.66, 203.0.113.10' },
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: EVENT_ID }) },
		);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ deleted: true });
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			expect.anything(),
			`events:item:wg-1:${MEMBER.memberId}`,
		);
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'event.deleted', entityId: EVENT_ID }),
		);
	});

	it('RED BUG-198: forbids regular members from patching another member event', async () => {
		const otherMemberId = '6c3b0e4b-48f2-4743-9e2c-f0c0771cbd1f';
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: MEMBER.memberId, name: 'Ava', verified: true },
		});
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[
				{
					startsAt: new Date('2026-06-01T08:00:00.000Z'),
					endsAt: null,
					createdByMemberId: otherMemberId,
				},
			],
		);
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [
						{
							id: EVENT_ID,
							wgId: 'wg-1',
							title: 'Fremd editiert',
							description: null,
							startsAt: new Date('2026-06-01T08:00:00.000Z'),
							endsAt: null,
							allDay: false,
							location: null,
							recurrence: null,
							createdByMemberId: otherMemberId,
							createdAt: new Date('2026-05-24T00:00:00.000Z'),
							updatedAt: new Date('2026-05-25T00:00:00.000Z'),
						},
					],
				}),
			}),
		});

		const { PATCH } = await import('./route');
		const res = await PATCH(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/events/${EVENT_ID}`, {
				method: 'PATCH',
				body: JSON.stringify({ title: 'Fremd editiert' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: EVENT_ID }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'not_owner', code: 'not_owner' });
		expect(routeDb.update).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-226: forbids regular members from deleting another member event', async () => {
		const otherMemberId = '6c3b0e4b-48f2-4743-9e2c-f0c0771cbd1f';
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: MEMBER.memberId, name: 'Ava', verified: true },
		});
		mockSelectResponses(
			[{ id: 'wg-1' }],
			[{ title: 'Fremder Termin', createdByMemberId: otherMemberId }],
		);
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [{ id: EVENT_ID }],
			}),
		});

		const { DELETE } = await import('./route');
		const res = await DELETE(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/events/${EVENT_ID}`, {
				method: 'DELETE',
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: EVENT_ID }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'not_owner', code: 'not_owner' });
		expect(routeDb.delete).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});
});
