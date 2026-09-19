import { expect, test } from '@playwright/test';
import {
	type DispatchInput,
	dispatchNotificationSafely,
} from '../src/core/notifications/notification-dispatch';

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
