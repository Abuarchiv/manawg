import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/announcement-workflow', () => ({
	ANNOUNCEMENT_KINDS: ['info', 'request', 'event'],
	ANNOUNCEMENT_SOURCES: ['manual', 'system', 'chore_swap', 'expense', 'shopping'],
	summarizeAnnouncementReactions: vi.fn(() => new Map()),
}));

vi.mock('@/core/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/core/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		wgWriteLimiter: {},
	};
});

describe('announcements route', () => {
	beforeEach(() => {
		resetRouteHarness();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava' },
		});
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		routeMocks.dispatchNotification.mockResolvedValue(undefined);
	});

	it('returns field-specific validation errors for announcement metadata before auth or db work', async () => {
		const { POST } = await import('./route');
		const cases: Array<{ body: Record<string, unknown>; error: string }> = [
			{ body: { content: 'Bitte beachten', kind: 'urgent' }, error: 'kind_invalid' },
			{ body: { content: 'Bitte beachten', imageUrl: 'x'.repeat(2049) }, error: 'image_invalid' },
			{
				body: { content: 'Bitte beachten', sourcePath: 'putzen?highlight=c1' },
				error: 'source_path_invalid',
			},
		];

		for (const testCase of cases) {
			const res = await POST(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT/announcements', {
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

	it('stores member-created announcements as manual even when the payload spoofs system source', async () => {
		const insertedValues: Array<Record<string, unknown>> = [];
		routeDb.select.mockReturnValue({
			from: () => ({
				where: () => ({
					limit: async () => [{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }],
				}),
			}),
		});
		routeDb.insert.mockReturnValue({
			values: (values: Record<string, unknown>) => {
				insertedValues.push(values);
				return {
					returning: async () => [{ id: 'announcement-1', ...values }],
				};
			},
		});

		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/announcements', {
				method: 'POST',
				body: JSON.stringify({ content: 'Fake-Systemnachricht', source: 'system' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		expect(insertedValues[0]).toEqual(expect.objectContaining({ source: 'manual' }));
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ source: 'manual' }),
			}),
		);
	});
});
