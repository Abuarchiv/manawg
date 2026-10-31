import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { withEnv } from '../../../tests/support/env';

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
let sendNotification: () => Promise<void> = async () => {};
mock.module('web-push', {
	namedExports: { setVapidDetails: () => {}, sendNotification: () => sendNotification() },
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

const VAPID_KEYS = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private' };
const VAPID_ENV = { ...VAPID_KEYS, VAPID_SUBJECT: 'mailto:ops@example.test' };

test('test push without a live subscription is a typed error, not a server failure', async () => {
	await withEnv(VAPID_ENV, async () => {
		for (const pushOptIn of [true, false]) {
			memberRows = [member(pushOptIn)];
			await assert.rejects(dispatchNotification(input), NoPushSubscriptionError);
		}
	});
});

test('test push without VAPID keys stays a server-side delivery failure', async () => {
	memberRows = [member(true)];
	await withEnv({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined }, () =>
		assert.rejects(dispatchNotification(input), (err: unknown) => {
			assert.ok(!(err instanceof NoPushSubscriptionError));
			assert.equal((err as Error).message, 'notification_delivery_failed');
			return true;
		}),
	);
});

test('an urgent push reaches a member in quiet hours, a normal one does not', async () => {
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
		await withEnv(VAPID_ENV, async () => {
			assert.equal((await dispatchNotification(change)).sent, 0);
			assert.equal((await dispatchNotification({ ...change, urgent: true })).sent, 1);
		});
	} finally {
		subscriptionRows = [];
	}
});

test('without VAPID_SUBJECT push is skipped outside production and refused in production', async () => {
	memberRows = [{ ...member(true), notifyEvents: true }];
	subscriptionRows = [{ id: 'sub-1', endpoint: 'https://push.test', p256dh: 'p', authKey: 'a' }];
	const change = {
		wg: input.wg,
		event: 'event.cancelled' as const,
		payload: { title: 'Plenum', startsAt: new Date().toISOString(), allDay: false },
		urgent: true,
	};
	try {
		await withEnv({ ...VAPID_KEYS, VAPID_SUBJECT: undefined, NODE_ENV: 'test' }, async () => {
			assert.equal((await dispatchNotification(change)).sent, 0);
		});
		await withEnv({ ...VAPID_KEYS, VAPID_SUBJECT: ' ', NODE_ENV: 'production' }, async () => {
			const { sent, failures } = await dispatchNotification(change);
			assert.equal(sent, 0);
			assert.match(String(failures[0]), /VAPID_SUBJECT must be configured/);
		});
	} finally {
		subscriptionRows = [];
	}
});

test('a rejected push logs the push service status', async () => {
	memberRows = [{ ...member(true), notifyEvents: true }];
	subscriptionRows = [{ id: 'sub-1', endpoint: 'https://push.test', p256dh: 'p', authKey: 'a' }];
	sendNotification = async () => {
		throw Object.assign(new Error('forbidden'), { statusCode: 403 });
	};
	const logged = mock.method(console, 'error', () => {});
	try {
		await withEnv(VAPID_ENV, async () => {
			const { sent, failures } = await dispatchNotification({
				wg: input.wg,
				event: 'event.cancelled',
				payload: { title: 'Plenum', startsAt: new Date().toISOString(), allDay: false },
				urgent: true,
			});
			assert.equal(sent, 0);
			assert.equal(failures.length, 1);
		});
		assert.ok(logged.mock.calls.some((call) => String(call.arguments[0]).includes('status:403')));
	} finally {
		logged.mock.restore();
		sendNotification = async () => {};
		subscriptionRows = [];
	}
});

test('a rejected push without a status code logs none', async () => {
	memberRows = [{ ...member(true), notifyEvents: true }];
	subscriptionRows = [{ id: 'sub-1', endpoint: 'https://push.test', p256dh: 'p', authKey: 'a' }];
	sendNotification = async () => {
		throw new Error('socket hang up');
	};
	const logged = mock.method(console, 'error', () => {});
	try {
		await withEnv(VAPID_ENV, async () => {
			const { sent, failures } = await dispatchNotification({
				wg: input.wg,
				event: 'event.cancelled',
				payload: { title: 'Plenum', startsAt: new Date().toISOString(), allDay: false },
				urgent: true,
			});
			assert.equal(sent, 0);
			assert.equal(failures.length, 1);
		});
		assert.ok(logged.mock.calls.some((call) => String(call.arguments[0]).includes('status:none')));
	} finally {
		logged.mock.restore();
		sendNotification = async () => {};
		subscriptionRows = [];
	}
});
