import { chores } from '@/lib/db';
import { chainOf, chainRejecting, resetRouteHarness, routeDb } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const guardMock = vi.hoisted(() => ({ requireWgMember: vi.fn() }));

vi.mock('@/lib/wg/require-wg-member', () => ({
	requireWgMember: (...args: unknown[]) => guardMock.requireWgMember(...args),
}));

/**
 * `eq` is the one operator this suite inspects, so it is replaced with an
 * inspectable marker while the rest of drizzle — including `relations` and
 * `sql`, which the schema module needs at import time — stays real.
 */
vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	eq: (...args: unknown[]) => ({ eq: args }),
}));

const ACTIVITY_REQUEST = new NextRequest('https://mana.test/api/wg/MTE8PZAT/activity');
const PARAMS = { params: Promise.resolve({ code: 'MTE8PZAT' }) };

describe('activity route DB errors', () => {
	beforeEach(() => {
		resetRouteHarness();
		guardMock.requireWgMember.mockResolvedValue({
			ok: true,
			wg: { id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' },
			member: { memberId: 'member-1', name: 'Ava' },
		});
	});

	it('returns 500 instead of hiding audit table errors as an empty activity list', async () => {
		const { GET } = await import('./route');
		for (let i = 0; i < 7; i += 1) routeDb.select.mockReturnValueOnce(chainOf([]));
		routeDb.select.mockReturnValueOnce(chainRejecting(new Error('audit schema drift')));

		const res = await GET(ACTIVITY_REQUEST, PARAMS);

		expect(res.status).toBe(500);
	});

	it('RED BUG-303: queries chore completions by WG instead of only the first 120 chore ids', async () => {
		const { GET } = await import('./route');
		let completionWhere: unknown;
		const choreRows = Array.from({ length: 120 }, (_, index) => ({
			assignedMemberId: 'member-1',
			id: `chore-${index}`,
			nextDueAt: new Date(`2026-05-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.000Z`),
			title: `Chore ${index}`,
		}));

		routeDb.select
			.mockReturnValueOnce(chainOf([{ id: 'member-1', name: 'Ava' }]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf(choreRows))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(
				chainOf([], {
					onWhere: (condition) => {
						completionWhere = condition;
					},
				}),
			);

		const res = await GET(ACTIVITY_REQUEST, PARAMS);

		expect(res.status).toBe(200);
		// Scoped by WG, not by an inArray over the chore ids that were just read —
		// the latter silently drops completions past the chore query's limit.
		expect(completionWhere).toEqual({ eq: [chores.wgId, 'wg-1'] });
	});
});
