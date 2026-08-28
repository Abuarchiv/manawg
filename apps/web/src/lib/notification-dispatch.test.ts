import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
	select: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
	insert: vi.fn(),
}));

const webPushMock = vi.hoisted(() => ({
	sendNotification: vi.fn(),
	setVapidDetails: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
	db: {
		select: (...args: unknown[]) => dbMock.select(...args),
		update: (...args: unknown[]) => dbMock.update(...args),
		delete: (...args: unknown[]) => dbMock.delete(...args),
		insert: (...args: unknown[]) => dbMock.insert(...args),
	},
	pushSubscriptions: {
		authKey: 'pushSubscriptions.authKey',
		endpoint: 'pushSubscriptions.endpoint',
		id: 'pushSubscriptions.id',
		memberId: 'pushSubscriptions.memberId',
		p256dh: 'pushSubscriptions.p256dh',
	},
	wgMembers: {
		id: 'wgMembers.id',
		wgId: 'wgMembers.wgId',
		pushOptIn: 'wgMembers.pushOptIn',
		notifyAnnouncements: 'wgMembers.notifyAnnouncements',
		notifyChores: 'wgMembers.notifyChores',
		notifyExpenses: 'wgMembers.notifyExpenses',
		notifyShopping: 'wgMembers.notifyShopping',
		notifyReminders: 'wgMembers.notifyReminders',
		notifyChat: 'wgMembers.notifyChat',
		notifyEvents: 'wgMembers.notifyEvents',
		quietEndHour: 'wgMembers.quietEndHour',
		deactivatedAt: 'wgMembers.deactivatedAt',
	},
}));

vi.mock('web-push', () => ({
	default: webPushMock,
	sendNotification: (...args: unknown[]) => webPushMock.sendNotification(...args),
	setVapidDetails: (...args: unknown[]) => webPushMock.setVapidDetails(...args),
}));

vi.mock('drizzle-orm', () => ({
	and: (...args: unknown[]) => ({ and: args }),
	eq: (...args: unknown[]) => ({ eq: args }),
	inArray: (...args: unknown[]) => ({ inArray: args }),
	isNull: (col: unknown) => ({ isNull: [col] }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
}));

import { buildNotificationUrl, dispatchNotification } from './notification-dispatch';

function selectRows(rows: unknown[]) {
	return {
		from: () => ({
			where: vi.fn().mockResolvedValue(rows),
		}),
	};
}

describe('notification dispatch helpers', () => {
	beforeEach(() => {
		dbMock.select.mockReset();
		dbMock.update.mockReset();
		dbMock.delete.mockReset();
		dbMock.insert.mockReset();
		webPushMock.sendNotification.mockReset();
		webPushMock.setVapidDetails.mockReset();
		webPushMock.sendNotification.mockRejectedValue(
			Object.assign(new Error('Gone'), { statusCode: 410 }),
		);
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it('builds absolute WG-scoped notification URLs', () => {
		vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mana.example/');

		expect(buildNotificationUrl('MTE8PZAT', '/pinnwand#announcement-a1')).toBe(
			'https://mana.example/wg/MTE8PZAT/pinnwand#announcement-a1',
		);
	});

	it('encodes the WG code in notification deep links', () => {
		vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mana.example/');

		expect(buildNotificationUrl('WG/123?x=1', '/pinnwand#announcement-a1')).toBe(
			'https://mana.example/wg/WG%2F123%3Fx%3D1/pinnwand#announcement-a1',
		);
	});

	it('routes event.upcoming via notifyEvents, not notifyAnnouncements', async () => {
		dbMock.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn().mockResolvedValue([
					{
						id: 'member-yes',
						pushOptIn: false,
						notifyAnnouncements: false,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						notifyReminders: true,
						notifyChat: true,
						notifyEvents: true,
						quietStartHour: null,
						quietEndHour: null,
					},
					{
						id: 'member-muted',
						pushOptIn: false,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						notifyReminders: true,
						notifyChat: true,
						notifyEvents: false,
						quietStartHour: null,
						quietEndHour: null,
					},
				]),
			})),
		});

		await dispatchNotification({
			wg: { id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' },
			event: 'event.upcoming',
			payload: { eventId: 'e1', title: 'Putzdienst', startsAt: new Date().toISOString() },
		});

		expect(dbMock.select).toHaveBeenCalledTimes(1);
	});

	it('does not broadcast when explicit targetMemberIds is empty', async () => {
		await dispatchNotification({
			wg: { id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' },
			event: 'announcement.posted',
			payload: { announcementId: 'a1', title: 'Hallo' },
			targetMemberIds: [],
		});

		expect(dbMock.select).not.toHaveBeenCalled();
	});

	it('RED BUG-014/153: scopes explicit target members to the notification WG', async () => {
		const whereSpy = vi.fn().mockResolvedValue([]);
		dbMock.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: whereSpy,
			})),
		});

		await dispatchNotification({
			wg: { id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' },
			event: 'announcement.posted',
			payload: { announcementId: 'a1', title: 'Hallo' },
			targetMemberIds: ['foreign-member-id'],
		});
		expect(whereSpy).toHaveBeenCalledWith({
			and: [
				{ eq: ['wgMembers.wgId', 'wg-1'] },
				{ inArray: ['wgMembers.id', ['foreign-member-id']] },
				{ isNull: ['wgMembers.deactivatedAt'] },
			],
		});
	});

	it('RED AUTH-BOUNDARY: excludes deactivated members from recipient selection', async () => {
		const whereSpy = vi.fn().mockResolvedValue([]);
		dbMock.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: whereSpy,
			})),
		});

		await dispatchNotification({
			wg: { id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' },
			event: 'announcement.posted',
			payload: { announcementId: 'a1', title: 'Hallo' },
		});

		expect(whereSpy).toHaveBeenCalledWith({
			and: expect.arrayContaining([{ isNull: ['wgMembers.deactivatedAt'] }]),
		});
	});

	it('RED BUG-338: refreshes member push opt-in when a stale subscription is deleted', async () => {
		vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key');
		vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key');

		const deleteWhere = vi.fn().mockResolvedValue(undefined);
		const memberUpdateSet = vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn().mockResolvedValue([{ id: 'member-stale' }]),
			})),
		}));

		dbMock.select
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([
						{
							id: 'member-stale',
							pushOptIn: true,
							notifyAnnouncements: true,
							notifyChores: true,
							notifyExpenses: true,
							notifyShopping: true,
							notifyReminders: true,
							notifyChat: true,
							notifyEvents: true,
							quietStartHour: null,
							quietEndHour: null,
						},
					]),
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([
						{
							id: 'sub-stale',
							endpoint: 'https://push.example/stale',
							p256dh: 'p256dh',
							authKey: 'auth',
						},
					]),
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([]),
				})),
			});
		dbMock.delete.mockReturnValueOnce({ where: deleteWhere });
		dbMock.update.mockReturnValueOnce({ set: memberUpdateSet });

		await dispatchNotification({
			wg: { id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' },
			event: 'announcement.posted',
			payload: { announcementId: 'a1', title: 'Hallo' },
			targetMemberIds: ['member-stale'],
		});

		expect(deleteWhere).toHaveBeenCalledWith({ eq: ['pushSubscriptions.id', 'sub-stale'] });
		expect(memberUpdateSet).toHaveBeenCalledWith({
			pushOptIn: expect.objectContaining({
				values: [
					expect.objectContaining({ id: 'pushSubscriptions.id' }),
					'pushSubscriptions.memberId',
					'member-stale',
				],
			}),
		});
	});

	it('keeps pushOptIn true when stale cleanup races a concurrently saved replacement endpoint', async () => {
		vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key');
		vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key');

		let resolveStaleDeleted!: () => void;
		const staleDeleted = new Promise<void>((resolve) => {
			resolveStaleDeleted = resolve;
		});
		let resolveConcurrentSubscribeDone!: () => void;
		const concurrentSubscribeDone = new Promise<void>((resolve) => {
			resolveConcurrentSubscribeDone = resolve;
		});
		let replacementEndpointExists = false;
		let persistedPushOptIn: boolean | null = null;

		dbMock.select
			.mockReturnValueOnce(
				selectRows([
					{
						id: 'member-1',
						pushOptIn: true,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						notifyReminders: true,
						notifyChat: true,
						notifyEvents: true,
						quietStartHour: null,
						quietEndHour: null,
					},
				]),
			)
			.mockReturnValueOnce(
				selectRows([
					{
						id: 'old-subscription',
						endpoint: 'https://push.example.test/old',
						p256dh: 'old-p256dh',
						authKey: 'old-auth',
					},
				]),
			)
			.mockReturnValueOnce(selectRows([]));
		dbMock.delete.mockReturnValue({
			where: vi.fn().mockImplementation(async () => {
				resolveStaleDeleted();
			}),
		});
		dbMock.update.mockReturnValue({
			set: vi.fn((values: { pushOptIn?: unknown }) => ({
				where: vi.fn().mockImplementation(async () => {
					await concurrentSubscribeDone;
					if (typeof values.pushOptIn === 'boolean') {
						persistedPushOptIn = values.pushOptIn;
					} else {
						persistedPushOptIn = replacementEndpointExists;
					}
					return [{ id: 'member-1' }];
				}),
			})),
		});

		const dispatch = dispatchNotification({
			wg: { id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' },
			event: 'announcement.posted',
			payload: { announcementId: 'a1', title: 'Hallo' },
			targetMemberIds: ['member-1'],
		});
		await staleDeleted;
		replacementEndpointExists = true;
		resolveConcurrentSubscribeDone();
		await dispatch;

		expect(persistedPushOptIn).toBe(true);
	});

	it('BUG-586: reports test notification failure when every provider send fails', async () => {
		vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key');
		vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		webPushMock.sendNotification.mockRejectedValue(
			Object.assign(new Error('Push provider unavailable'), { statusCode: 503 }),
		);
		dbMock.select
			.mockReturnValueOnce(
				selectRows([
					{
						id: 'member-1',
						pushOptIn: true,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						notifyReminders: true,
						notifyChat: true,
						notifyEvents: true,
						quietStartHour: null,
						quietEndHour: null,
					},
				]),
			)
			.mockReturnValueOnce(
				selectRows([
					{
						id: 'sub-1',
						endpoint: 'https://push.example.test/subscription-1',
						p256dh: 'p256dh-key',
						authKey: 'auth-key',
					},
				]),
			);

		await expect(
			dispatchNotification({
				wg: { id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' },
				event: 'notification.test',
				payload: {},
				targetMemberIds: ['member-1'],
				bypassPreferences: true,
			}),
		).rejects.toThrow('Push provider unavailable');

		expect(webPushMock.sendNotification).toHaveBeenCalledTimes(1);
	});

	it('keeps stale test notification subscriptions non-fatal', async () => {
		vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key');
		vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key');
		const deleteWhere = vi.fn().mockResolvedValue(undefined);
		dbMock.select
			.mockReturnValueOnce(
				selectRows([
					{
						id: 'member-stale',
						pushOptIn: true,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						notifyReminders: true,
						notifyChat: true,
						notifyEvents: true,
						quietStartHour: null,
						quietEndHour: null,
					},
				]),
			)
			.mockReturnValueOnce(
				selectRows([
					{
						id: 'sub-stale',
						endpoint: 'https://push.example.test/stale',
						p256dh: 'p256dh-key',
						authKey: 'auth-key',
					},
				]),
			)
			.mockReturnValueOnce(selectRows([]));
		dbMock.delete.mockReturnValueOnce({ where: deleteWhere });
		dbMock.update.mockReturnValueOnce({ set: vi.fn(() => ({ where: vi.fn() })) });

		await expect(
			dispatchNotification({
				wg: { id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' },
				event: 'notification.test',
				payload: {},
				targetMemberIds: ['member-stale'],
				bypassPreferences: true,
			}),
		).resolves.toEqual({ sent: 0 });

		expect(deleteWhere).toHaveBeenCalledWith({ eq: ['pushSubscriptions.id', 'sub-stale'] });
	});

	it('keeps ordinary notification provider failures best-effort', async () => {
		vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key');
		vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		webPushMock.sendNotification.mockRejectedValue(
			Object.assign(new Error('Push provider unavailable'), { statusCode: 503 }),
		);
		dbMock.select
			.mockReturnValueOnce(
				selectRows([
					{
						id: 'member-1',
						pushOptIn: true,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						notifyReminders: true,
						notifyChat: true,
						notifyEvents: true,
						quietStartHour: null,
						quietEndHour: null,
					},
				]),
			)
			.mockReturnValueOnce(
				selectRows([
					{
						id: 'sub-1',
						endpoint: 'https://push.example.test/subscription-1',
						p256dh: 'p256dh-key',
						authKey: 'auth-key',
					},
				]),
			);

		await expect(
			dispatchNotification({
				wg: { id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT' },
				event: 'announcement.posted',
				payload: { announcementId: 'a1', title: 'Hallo' },
				targetMemberIds: ['member-1'],
			}),
		).resolves.toEqual({ sent: 0 });

		expect(webPushMock.sendNotification).toHaveBeenCalledTimes(1);
	});
});
