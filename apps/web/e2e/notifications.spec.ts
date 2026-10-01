// Push notification contracts: dispatch routing and subscription validation.
// Malformed endpoints/keys must be rejected server-side, transient push failures must not drop subscriptions.

import { expect, test } from '@playwright/test';
import {
	type DispatchInput,
	dispatchNotificationSafely,
} from '../src/core/notifications/notification-dispatch';
import { isTransientWebPushStatus } from '../src/core/notifications/web-push-errors';
import {
	pushAuthKeySchema,
	pushEndpointSchema,
	pushP256dhSchema,
} from '../src/core/validators/push-endpoint';

test.describe('notification dispatch contract', () => {
	const input: DispatchInput = {
		wg: { id: 'wg-id', name: 'Test WG', shareCode: 'test-code' },
		event: 'notification.test',
		payload: {},
	};

	test('returns sent and no warning when delivery succeeds', async () => {
		await expect(
			dispatchNotificationSafely(input, {
				timeoutMs: 100,
				dispatch: async () => ({ sent: 2, failures: [] }),
			}),
		).resolves.toEqual({ sent: 2, warning: null });
	});

	test('returns a failed warning for partial delivery failures', async () => {
		await expect(
			dispatchNotificationSafely(input, {
				timeoutMs: 100,
				dispatch: async () => ({ sent: 1, failures: [new Error('provider failed')] }),
			}),
		).resolves.toEqual({ sent: 1, warning: 'notification_delivery_failed' });
	});

	test('returns an unknown warning when dispatch throws', async () => {
		await expect(
			dispatchNotificationSafely(input, {
				timeoutMs: 100,
				dispatch: async () => {
					throw new Error('provider unavailable');
				},
			}),
		).resolves.toEqual({ sent: 0, warning: 'notification_delivery_unknown' });
	});

	test('returns an unknown warning when dispatch exceeds the total budget', async () => {
		await expect(
			dispatchNotificationSafely(input, {
				timeoutMs: 10,
				dispatch: () => new Promise(() => undefined),
			}),
		).resolves.toEqual({ sent: 0, warning: 'notification_delivery_unknown' });
	});
});

test.describe('push validator', () => {
	test('push subscription fields reject malformed and oversized values', () => {
		expect(pushEndpointSchema.safeParse('https://fcm.googleapis.com/fcm/send/token').success).toBe(
			true,
		);
		expect(pushP256dhSchema.safeParse('A'.repeat(87)).success).toBe(true);
		expect(pushAuthKeySchema.safeParse('A'.repeat(22)).success).toBe(true);
		expect(pushP256dhSchema.safeParse('A'.repeat(86)).success).toBe(false);
		expect(pushAuthKeySchema.safeParse('A'.repeat(23)).success).toBe(false);
		expect(pushAuthKeySchema.safeParse('!'.repeat(22)).success).toBe(false);
		expect(isTransientWebPushStatus(429)).toBe(true);
		expect(isTransientWebPushStatus(503)).toBe(true);
		expect(isTransientWebPushStatus(400)).toBe(false);
	});
});
