import { chainOf, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reminderClaimMock = vi.hoisted(() => ({
	seen: new Set<string>(),
}));

const CRON_SECRET = 'test-secret';
const AUTH_HEADER = { authorization: `Bearer ${CRON_SECRET}` };

interface DueRow {
	id: string;
	title: string;
	assignedMemberId: string | null;
	lastReminderAt: Date | null;
	wgId: string;
	wgName: string;
	shareCode: string;
}

interface ChainOptions {
	due: DueRow[];
	completionChoreIds: string[];
}

function buildSelectChain({ due, completionChoreIds }: ChainOptions): void {
	routeDb.select
		.mockReturnValueOnce(chainOf(due))
		.mockReturnValueOnce(chainOf(completionChoreIds.map((choreId) => ({ choreId }))));
}

interface UpdateCaptured {
	setArg: unknown;
	whereArg: unknown;
}

function buildUpdateCapture(): { capture: UpdateCaptured } {
	const captured: UpdateCaptured = { setArg: undefined, whereArg: undefined };
	routeDb.update.mockReturnValue({
		set: (setArg: unknown) => {
			captured.setArg = setArg;
			return {
				where: (whereArg: unknown) => {
					captured.whereArg = whereArg;
					return Promise.resolve();
				},
			};
		},
	});
	return { capture: captured };
}

describe('chore reminders cron route', () => {
	beforeEach(() => {
		resetRouteHarness();
		reminderClaimMock.seen.clear();
		vi.unstubAllEnvs();
		routeMocks.dispatchNotification.mockResolvedValue({ sent: 1 });
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
		routeDb.delete.mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined),
		});
	});

	it('returns 503 when CRON_SECRET is missing (fail-closed)', async () => {
		const { GET } = await import('./route');
		const res = await GET(new NextRequest('https://mana.test/api/cron/chore-reminders'));
		expect(res.status).toBe(503);
	});

	it('returns 401 when CRON_SECRET is set but no Bearer header', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		const { GET } = await import('./route');
		const res = await GET(new NextRequest('https://mana.test/api/cron/chore-reminders'));
		expect(res.status).toBe(401);
	});

	it('passes chore ids to due reminder notifications for direct links', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		const { GET } = await import('./route');
		const choreId = 'chore-1';
		const memberId = 'member-1';
		buildSelectChain({
			due: [
				{
					id: choreId,
					title: 'Bad putzen',
					assignedMemberId: memberId,
					lastReminderAt: null,
					wgId: 'wg-1',
					wgName: 'Küche 4',
					shareCode: 'MTE8PZAT',
				},
			],
			completionChoreIds: [],
		});
		const { capture } = buildUpdateCapture();
		routeMocks.dispatchNotification.mockResolvedValue({ sent: 1 });

		const res = await GET(
			new NextRequest('https://mana.test/api/cron/chore-reminders', {
				headers: AUTH_HEADER,
			}),
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, sent: 1 });
		expect(routeMocks.dispatchNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'chore.due',
				payload: expect.objectContaining({ choreId }),
				targetMemberIds: [memberId],
			}),
		);
		// Successful dispatch should stamp lastReminderAt to throttle next cron run.
		expect(routeDb.update).toHaveBeenCalledTimes(1);
		expect(capture.setArg).toMatchObject({ lastReminderAt: expect.any(Date) });
	});

	it('skips chores reminded within the throttle window (18h)', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		const { GET } = await import('./route');
		const recentlyReminded = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4h ago
		buildSelectChain({
			due: [
				{
					id: 'chore-recent',
					title: 'Müll raus',
					assignedMemberId: 'member-1',
					lastReminderAt: recentlyReminded,
					wgId: 'wg-1',
					wgName: 'WG 1',
					shareCode: 'CODE1234',
				},
			],
			completionChoreIds: [],
		});
		buildUpdateCapture();
		routeMocks.dispatchNotification.mockResolvedValue({ sent: 1 });

		const res = await GET(
			new NextRequest('https://mana.test/api/cron/chore-reminders', {
				headers: AUTH_HEADER,
			}),
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, sent: 0 });
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
	});

	it('sends again once the throttle window has elapsed (>18h)', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		const { GET } = await import('./route');
		const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago
		buildSelectChain({
			due: [
				{
					id: 'chore-old',
					title: 'Spülen',
					assignedMemberId: 'member-1',
					lastReminderAt: longAgo,
					wgId: 'wg-1',
					wgName: 'WG 1',
					shareCode: 'CODE1234',
				},
			],
			completionChoreIds: [],
		});
		buildUpdateCapture();
		routeMocks.dispatchNotification.mockResolvedValue({ sent: 1 });

		const res = await GET(
			new NextRequest('https://mana.test/api/cron/chore-reminders', {
				headers: AUTH_HEADER,
			}),
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, sent: 1 });
		expect(routeMocks.dispatchNotification).toHaveBeenCalledTimes(1);
		expect(routeDb.update).toHaveBeenCalledTimes(1);
	});

	it('skips unassigned chores defensively when reminder rows contain null assignees', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		const { GET } = await import('./route');
		buildSelectChain({
			due: [
				{
					id: 'chore-open',
					title: 'Offene Aufgabe',
					assignedMemberId: null,
					lastReminderAt: null,
					wgId: 'wg-1',
					wgName: 'WG 1',
					shareCode: 'CODE1234',
				},
			],
			completionChoreIds: [],
		});
		buildUpdateCapture();

		const res = await GET(
			new NextRequest('https://mana.test/api/cron/chore-reminders', {
				headers: AUTH_HEADER,
			}),
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, sent: 0 });
		expect(routeMocks.dispatchNotification).not.toHaveBeenCalled();
		expect(routeDb.update).not.toHaveBeenCalled();
	});

	it('does not stamp lastReminderAt when dispatch fails (so next cron retries)', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		const { GET } = await import('./route');
		buildSelectChain({
			due: [
				{
					id: 'chore-fail',
					title: 'Boden wischen',
					assignedMemberId: 'member-1',
					lastReminderAt: null,
					wgId: 'wg-1',
					wgName: 'WG 1',
					shareCode: 'CODE1234',
				},
			],
			completionChoreIds: [],
		});
		buildUpdateCapture();
		routeMocks.dispatchNotification.mockRejectedValue(new Error('push gateway down'));

		const res = await GET(
			new NextRequest('https://mana.test/api/cron/chore-reminders', {
				headers: AUTH_HEADER,
			}),
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, sent: 0 });
		expect(routeMocks.dispatchNotification).toHaveBeenCalledTimes(1);
		expect(routeDb.delete).toHaveBeenCalledTimes(1);
		expect(routeDb.update).not.toHaveBeenCalled();
	});

	it('does not dispatch the same due chore twice during overlapping cron runs', async () => {
		vi.stubEnv('CRON_SECRET', CRON_SECRET);
		const { GET } = await import('./route');
		const dueRow = {
			id: 'chore-race',
			title: 'Bad putzen',
			assignedMemberId: 'member-1',
			lastReminderAt: null,
			wgId: 'wg-1',
			wgName: 'WG 1',
			shareCode: 'CODE1234',
		};
		routeDb.select.mockImplementation((selection?: unknown) => {
			if (selection && typeof selection === 'object' && 'id' in selection) {
				return chainOf([dueRow]);
			}
			return chainOf([]);
		});
		buildUpdateCapture();
		let resolveDispatch: () => void = () => {};
		routeMocks.dispatchNotification.mockReturnValue(
			new Promise<{ sent: number }>((resolve) => {
				resolveDispatch = () => resolve({ sent: 1 });
			}),
		);

		const first = GET(
			new NextRequest('https://mana.test/api/cron/chore-reminders', {
				headers: AUTH_HEADER,
			}),
		);
		const replay = GET(
			new NextRequest('https://mana.test/api/cron/chore-reminders', {
				headers: AUTH_HEADER,
			}),
		);
		await vi.waitFor(() => {
			expect(routeDb.insert).toHaveBeenCalledTimes(2);
			expect(routeMocks.dispatchNotification).toHaveBeenCalledTimes(1);
		});
		resolveDispatch();

		const [firstRes, replayRes] = await Promise.all([first, replay]);
		expect(firstRes.status).toBe(200);
		expect(replayRes.status).toBe(200);
		const bodies = await Promise.all([firstRes.json(), replayRes.json()]);
		expect(bodies).toContainEqual({ ok: true, sent: 1 });
		expect(bodies).toContainEqual({ ok: true, sent: 0 });
		expect(routeMocks.dispatchNotification).toHaveBeenCalledTimes(1);
		expect(routeDb.update).toHaveBeenCalledTimes(1);
	});
});
