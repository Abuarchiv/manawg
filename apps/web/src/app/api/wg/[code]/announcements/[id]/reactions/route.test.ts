import { routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/announcement-workflow', () => ({
	ANNOUNCEMENT_REACTIONS: ['seen', 'takeover'],
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: {},
	};
});

function selectRows(rows: unknown[]) {
	return {
		from: () => ({
			where: () => ({
				limit: async () => rows,
			}),
		}),
	};
}

describe('announcement reactions route', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava' },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true });
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		routeMocks.dispatchNotification.mockResolvedValue(undefined);
	});

	it('reports an empty duplicate insert as already active without duplicate side effects', async () => {
		const { POST } = await import('./route');
		const announcementId = '39cb9a19-dac7-4da0-ac98-1ed433d67a57';
		routeDb.select
			.mockReturnValueOnce(selectRows([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]))
			.mockReturnValueOnce(
				selectRows([
					{
						id: announcementId,
						authorMemberId: 'member-2',
						content: 'Bitte Küche wischen',
					},
				]),
			)
			.mockReturnValueOnce(selectRows([]));
		routeDb.insert.mockReturnValue({
			values: () => ({
				onConflictDoNothing: () => ({
					returning: async () => [],
				}),
			}),
		});

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}/reactions`,
				{
					method: 'POST',
					body: JSON.stringify({ reaction: 'seen' }),
				},
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ reaction: 'seen', active: true });
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
	});

	it('does not report a reaction as inactive when deleting it returns no row', async () => {
		const { POST } = await import('./route');
		const announcementId = '39cb9a19-dac7-4da0-ac98-1ed433d67a57';
		routeDb.select
			.mockReturnValueOnce(selectRows([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]))
			.mockReturnValueOnce(
				selectRows([
					{
						id: announcementId,
						authorMemberId: 'member-2',
						content: 'Bitte Küche wischen',
					},
				]),
			)
			.mockReturnValueOnce(selectRows([{ id: 'reaction-1' }]));
		routeDb.delete.mockReturnValue({
			where: () => ({
				returning: async () => [],
			}),
		});

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}/reactions`,
				{
					method: 'POST',
					body: JSON.stringify({ reaction: 'seen' }),
				},
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId }) },
		);

		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: 'reaction_not_found' });
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
	});

	it('RED BUG-058: treats duplicate concurrent reaction inserts as already active', async () => {
		const { POST } = await import('./route');
		const announcementId = '39cb9a19-dac7-4da0-ac98-1ed433d67a57';
		routeDb.select
			.mockReturnValueOnce(selectRows([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]))
			.mockReturnValueOnce(
				selectRows([
					{
						id: announcementId,
						authorMemberId: 'member-2',
						content: 'Bitte Küche wischen',
					},
				]),
			)
			.mockReturnValueOnce(selectRows([]));
		routeDb.insert.mockReturnValue({
			values: () => ({
				onConflictDoNothing: () => ({
					returning: async () => [],
				}),
			}),
		});

		const res = await POST(
			new NextRequest(
				`https://mana.test/api/wg/MTE8PZAT/announcements/${announcementId}/reactions`,
				{
					method: 'POST',
					body: JSON.stringify({ reaction: 'seen' }),
				},
			),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ reaction: 'seen', active: true });
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
	});
});
