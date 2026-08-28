import { chainOf, columnRef, resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgWriteLimiter: { name: 'write' },
}));

// Stubbed rather than left to fail open, because this suite asserts the 429.
vi.mock('@/core/rate-limit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/core/rate-limit')>()),
	checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
	wgWriteLimiter: rateLimitMock.wgWriteLimiter,
}));

/**
 * Several tests here assert *how* a push-subscription query is scoped — that a
 * delete cannot reach another member's rows. `eq` is therefore replaced with a
 * marker carrying the column's real "table.column" label; the rest of drizzle
 * stays real so the schema module still imports.
 */
vi.mock('drizzle-orm', async (importOriginal) => ({
	...(await importOriginal<typeof import('drizzle-orm')>()),
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (column: unknown, value: unknown) => ({ eq: [columnRef(column), value] }),
}));

const txMock = vi.hoisted(() => ({ committed: false, rolledBack: false }));

vi.mock('@/core/db/transaction', async () => {
	const { TransactionAbort } = await import('@/core/db/transaction-abort');
	return {
		TransactionAbort,
		withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			try {
				const result = await fn({
					insert: (...args: unknown[]) => routeDb.insert(...args),
					update: (...args: unknown[]) => routeDb.update(...args),
				});
				txMock.committed = true;
				return result;
			} catch (err) {
				txMock.rolledBack = true;
				throw err;
			}
		},
	};
});

describe('notifications route', () => {
	beforeEach(() => {
		resetRouteHarness();
		txMock.committed = false;
		txMock.rolledBack = false;
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1', name: 'Ava' },
		});
		routeMocks.recordAuditEvent.mockResolvedValue(undefined);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 9, reset: 0 });
	});

	it('returns quiet_hours_invalid for invalid quiet hour updates before auth or db work', async () => {
		const { PATCH } = await import('./route');

		const res = await PATCH(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'PATCH',
				body: JSON.stringify({ quietStartHour: 24, quietEndHour: 7 }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'quiet_hours_invalid' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('returns push_subscription_invalid for malformed push subscription requests before auth or db work', async () => {
		const { POST } = await import('./route');

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_subscribe',
					endpoint: 'not-a-url',
					p256dh: 'p256dh-key',
					authKey: 'auth-key',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'push_subscription_invalid' });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	// A stored endpoint becomes a server-side fetch target on every WG event
	// (notification-dispatch POSTs to it), so a member must not be able to
	// aim it at an internal address. Rejected before any db work, like the
	// malformed case above.
	it('refuses a push endpoint outside the known push services', async () => {
		const { POST } = await import('./route');

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_subscribe',
					endpoint: 'http://169.254.169.254/latest/meta-data/',
					p256dh: 'p256dh-key',
					authKey: 'auth-key',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'push_subscription_invalid' });
		expect(routeDb.insert).not.toHaveBeenCalled();
	});

	it('returns 429 when push subscribe is rate-limited', async () => {
		const { POST } = await import('./route');
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0 });

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_subscribe',
					endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
					p256dh: 'p256dh-key',
					authKey: 'auth-key',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(429);
		await expect(res.json()).resolves.toEqual({ error: 'too_many_requests' });
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			'push-subscribe:wg-1:member-1',
		);
		expect(routeDb.insert).not.toHaveBeenCalled();
	});

	it('returns 429 when push unsubscribe is rate-limited', async () => {
		const { POST } = await import('./route');
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0 });

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_unsubscribe',
					endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(429);
		await expect(res.json()).resolves.toEqual({ error: 'too_many_requests' });
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			'push-unsubscribe:wg-1:member-1',
		);
		expect(routeDb.delete).not.toHaveBeenCalled();
	});

	it('scopes push unsubscribe deletion to the authenticated member', async () => {
		const { POST } = await import('./route');
		const deleteWhere = vi.fn(() => Promise.resolve([]));
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		routeDb.select.mockReturnValueOnce(chainOf([]));
		routeDb.delete.mockReturnValue({ where: deleteWhere });
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [{ id: 'member-1' }],
				}),
			}),
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_unsubscribe',
					endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		expect(deleteWhere).toHaveBeenCalledWith({
			and: [
				{
					eq: ['push_subscriptions.endpoint', 'https://fcm.googleapis.com/fcm/send/subscription-1'],
				},
				{ eq: ['push_subscriptions.member_id', 'member-1'] },
			],
		});
	});

	it('does not audit notification setting changes when the member update matches no row', async () => {
		const { PATCH } = await import('./route');
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [],
				}),
			}),
		});

		const res = await PATCH(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'PATCH',
				body: JSON.stringify({ pushOptIn: false }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: 'member_not_found' });
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-123: removes server push subscriptions when server-only push opt-out is saved', async () => {
		const { PATCH } = await import('./route');
		const deleteWhere = vi.fn(() => Promise.resolve([]));
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [{ id: 'member-1' }],
				}),
			}),
		});
		routeDb.delete.mockReturnValue({ where: deleteWhere });

		const res = await PATCH(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'PATCH',
				body: JSON.stringify({ pushOptIn: false }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		expect(deleteWhere).toHaveBeenCalledWith({ eq: ['push_subscriptions.member_id', 'member-1'] });
	});

	it('does not audit push unsubscribe when the opt-out member update matches no row', async () => {
		const { POST } = await import('./route');
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		routeDb.select.mockReturnValueOnce(chainOf([]));
		routeDb.delete.mockReturnValue({
			where: () => Promise.resolve([]),
		});
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [],
				}),
			}),
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_unsubscribe',
					endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: 'member_not_found' });
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('dispatches test notifications with preference bypass enabled', async () => {
		const { POST } = await import('./route');
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		routeMocks.dispatchNotification.mockResolvedValue(undefined);

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({ action: 'test_notification' }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		expect(routeMocks.dispatchNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'notification.test',
				targetMemberIds: ['member-1'],
				bypassPreferences: true,
			}),
		);
	});

	it('RED BUG-388: does not create a push subscription when member opt-in update fails', async () => {
		const { POST } = await import('./route');
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		routeDb.insert.mockReturnValue({
			values: vi.fn().mockResolvedValue(undefined),
		});
		routeDb.update.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [],
				}),
			}),
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_subscribe',
					endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
					p256dh: 'p256dh-key',
					authKey: 'auth-key',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: 'member_not_found' });
		expect(routeDb.insert).not.toHaveBeenCalled();
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	/**
	 * Opting in and storing the subscription are one action. If only the flag
	 * survives, the member is marked as reachable by push while no endpoint
	 * exists — every notification for them silently goes nowhere.
	 */
	it('rolls the push opt-in back and skips audit when the subscription cannot be stored', async () => {
		const { POST } = await import('./route');
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const updateSet = vi.fn(() => ({
			where: () => ({
				returning: async () => [{ id: 'member-1' }],
			}),
		}));
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		routeDb.update.mockReturnValue({ set: updateSet });
		routeDb.insert.mockReturnValue({
			values: () => ({
				onConflictDoUpdate: () => ({
					returning: () => Promise.reject(new Error('insert failed')),
				}),
			}),
		});

		try {
			const res = await POST(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
					method: 'POST',
					body: JSON.stringify({
						action: 'push_subscribe',
						endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
						p256dh: 'p256dh-key',
						authKey: 'auth-key',
					}),
				}),
				{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
			);

			expect(res.status).toBe(500);
			expect(txMock.rolledBack).toBe(true);
			expect(txMock.committed).toBe(false);
			// The opt-in disappears with the rollback. It used to be undone by a
			// second update writing `pushOptIn: false`, which was itself a
			// database call and left the member half-subscribed when it failed.
			expect(updateSet).not.toHaveBeenCalledWith({ pushOptIn: false });
			expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
		} finally {
			consoleErrorSpy.mockRestore();
		}
	});

	/**
	 * Browsers hand out a new key pair for the same endpoint after a service
	 * worker update, and two tabs can subscribe at once. The upsert makes both
	 * cases the same single statement, so there is no window between "does it
	 * exist" and "insert it" for a race to slip through.
	 */
	it('overwrites the stored keys when the member re-subscribes the same endpoint', async () => {
		const { POST } = await import('./route');
		const updateSet = vi.fn(() => ({
			where: () => ({
				returning: async () => [{ id: 'member-1' }],
			}),
		}));
		const conflictSet = vi.fn(() => ({
			returning: async () => [{ id: 'subscription-1' }],
		}));
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		routeDb.update.mockReturnValue({ set: updateSet });
		routeDb.insert.mockReturnValue({
			values: () => ({ onConflictDoUpdate: conflictSet }),
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_subscribe',
					endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
					p256dh: 'p256dh-key',
					authKey: 'auth-key',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		expect(txMock.committed).toBe(true);
		expect(updateSet).toHaveBeenCalledWith({ pushOptIn: true });
		expect(conflictSet).toHaveBeenCalledWith(
			expect.objectContaining({
				set: { p256dh: 'p256dh-key', authKey: 'auth-key', userAgent: null },
			}),
		);
		expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'notification.push.subscribed',
				metadata: { notificationFields: ['Web Push'], pushOptIn: true },
			}),
		);
	});

	/**
	 * The upsert is restricted to rows the caller already owns, so a foreign
	 * endpoint updates nothing and returns no row. Reporting success there
	 * would send this member's notifications to someone else's device.
	 */
	it('refuses the subscription and rolls back when the endpoint belongs to another member', async () => {
		const { POST } = await import('./route');
		const updateSet = vi.fn(() => ({
			where: () => ({
				returning: async () => [{ id: 'member-1' }],
			}),
		}));
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		routeDb.update.mockReturnValue({ set: updateSet });
		routeDb.insert.mockReturnValue({
			values: () => ({
				onConflictDoUpdate: () => ({
					returning: async () => [],
				}),
			}),
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_subscribe',
					endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
					p256dh: 'p256dh-key',
					authKey: 'auth-key',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'endpoint_owned', code: 'endpoint_owned' });
		expect(txMock.rolledBack).toBe(true);
		expect(updateSet).not.toHaveBeenCalledWith({ pushOptIn: false });
		expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled();
	});

	it('RED BUG-146: keeps pushOptIn true when unsubscribing one of multiple endpoints', async () => {
		const { POST } = await import('./route');
		const updateSet = vi.fn(() => ({
			where: () => ({
				returning: async () => [{ id: 'member-1' }],
			}),
		}));
		routeDb.select.mockReturnValueOnce(
			chainOf([{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }]),
		);
		routeDb.select.mockReturnValueOnce(chainOf([{ id: 'remaining-endpoint' }]));
		routeDb.delete.mockReturnValue({
			where: () => Promise.resolve([{ id: 'deleted-endpoint' }]),
		});
		routeDb.update.mockReturnValue({ set: updateSet });

		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_unsubscribe',
					endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		expect(updateSet).toHaveBeenCalledWith({ pushOptIn: true });
	});

	it('BUG-746: does not let stale unsubscribe disable a concurrently saved new endpoint', async () => {
		const { POST } = await import('./route');

		let resolveInsertDone!: () => void;
		const insertDone = new Promise<void>((resolve) => {
			resolveInsertDone = resolve;
		});
		let resolveRemainingRead!: () => void;
		const remainingRead = new Promise<void>((resolve) => {
			resolveRemainingRead = resolve;
		});
		let persistedPushOptIn: boolean | null = null;

		const updateSet = vi.fn((values: Record<string, unknown>) => ({
			where: () => ({
				returning: async () => {
					if (values.pushOptIn === false) {
						await insertDone;
					}
					if (typeof values.pushOptIn === 'boolean') {
						persistedPushOptIn = values.pushOptIn;
						return [{ id: 'member-1', pushOptIn: values.pushOptIn }];
					}
					return [{ id: 'member-1', pushOptIn: persistedPushOptIn ?? false }];
				},
			}),
		}));
		routeDb.update.mockReturnValue({ set: updateSet });
		routeDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
		routeDb.insert.mockReturnValue({
			values: vi.fn().mockReturnValue({
				onConflictDoUpdate: vi.fn().mockReturnValue({
					returning: async () => {
						resolveInsertDone();
						return [{ id: 'subscription-new' }];
					},
				}),
			}),
		});
		routeDb.select.mockImplementation(() => ({
			from: () => ({
				where: (condition: unknown) => ({
					limit: async () => {
						const serialized = JSON.stringify(condition);
						if (serialized.includes('wgs.share_code')) {
							return [{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' }];
						}
						if (serialized.includes('push_subscriptions.endpoint')) return [];
						if (serialized.includes('push_subscriptions.member_id')) {
							resolveRemainingRead();
							return [];
						}
						return [];
					},
				}),
			}),
		}));

		const unsubscribe = POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_unsubscribe',
					endpoint: 'https://fcm.googleapis.com/fcm/send/old-endpoint',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		await remainingRead;

		const subscribe = POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/notifications', {
				method: 'POST',
				body: JSON.stringify({
					action: 'push_subscribe',
					endpoint: 'https://fcm.googleapis.com/fcm/send/new-endpoint',
					p256dh: 'new-p256dh',
					authKey: 'new-auth',
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		await expect(Promise.all([unsubscribe, subscribe])).resolves.toEqual([
			expect.objectContaining({ status: 200 }),
			expect.objectContaining({ status: 200 }),
		]);

		expect(updateSet).toHaveBeenCalledWith({ pushOptIn: true });
		expect(updateSet).not.toHaveBeenCalledWith({ pushOptIn: false });
		expect(persistedPushOptIn).toBe(true);
	});
});
