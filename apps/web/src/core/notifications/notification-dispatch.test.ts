import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

const pushSubscriptions = { __table: 'push_subscriptions' };
const wgMembers = { __table: 'wg_members' };
let memberRows: unknown[] = [];
let subscriptionRows: unknown[] = [];

mock.module('@/core/db', {
	namedExports: {
		pushSubscriptions,
		wgMembers,
		db: {
			select: () => ({
				from: (table: unknown) => ({
					where: async () => (table === wgMembers ? memberRows : subscriptionRows),
				}),
			}),
		},
	},
});
mock.module('web-push', {
	namedExports: { setVapidDetails: () => {}, sendNotification: async () => {} },
});

const { dispatchNotification, NoPushSubscriptionError } = await import('./notification-dispatch');

const input = {
	wg: { id: 'wg-1', name: 'WG', shareCode: 'ABC' },
	event: 'notification.test' as const,
	payload: {},
	targetMemberIds: ['member-1'],
	bypassPreferences: true,
};

function member(pushOptIn: boolean) {
	return {
		id: 'member-1',
		deactivatedAt: null,
		pushOptIn,
		quietStartHour: null,
		quietEndHour: null,
	};
}

afterEach(() => {
	Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_VAPID_PUBLIC_KEY');
	Reflect.deleteProperty(process.env, 'VAPID_PRIVATE_KEY');
});

test('test push without a live subscription is a typed error, not a server failure', async () => {
	process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'public';
	process.env.VAPID_PRIVATE_KEY = 'private';
	for (const pushOptIn of [true, false]) {
		memberRows = [member(pushOptIn)];
		await assert.rejects(dispatchNotification(input), NoPushSubscriptionError);
	}
});

test('test push without VAPID keys stays a server-side delivery failure', async () => {
	memberRows = [member(true)];
	await assert.rejects(dispatchNotification(input), (err: unknown) => {
		assert.ok(!(err instanceof NoPushSubscriptionError));
		assert.equal((err as Error).message, 'notification_delivery_failed');
		return true;
	});
});

test('an urgent push reaches a member in quiet hours, a normal one does not', async () => {
	process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'public';
	process.env.VAPID_PRIVATE_KEY = 'private';
	const hour = Number(
		new Intl.DateTimeFormat('en-GB', {
			hour: 'numeric',
			hourCycle: 'h23',
			timeZone: 'Europe/Berlin',
		}).format(new Date()),
	);
	memberRows = [
		{
			...member(true),
			notifyEvents: true,
			quietStartHour: hour,
			quietEndHour: (hour + 1) % 24,
		},
	];
	subscriptionRows = [{ id: 'sub-1', endpoint: 'https://push.test', p256dh: 'p', authKey: 'a' }];
	const change = {
		wg: input.wg,
		event: 'event.cancelled' as const,
		payload: { title: 'Plenum', startsAt: new Date().toISOString(), allDay: false },
	};
	try {
		assert.equal((await dispatchNotification(change)).sent, 0);
		assert.equal((await dispatchNotification({ ...change, urgent: true })).sent, 1);
	} finally {
		subscriptionRows = [];
	}
});
