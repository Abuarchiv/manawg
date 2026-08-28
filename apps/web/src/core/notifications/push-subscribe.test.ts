// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	persistExistingWebPushSubscription,
	subscribeWebPush,
	unsubscribeWebPush,
} from './push-subscribe';

const apiMock = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: apiMock.apiFetch,
}));

const pushSubscriptionFromJson = (json: PushSubscriptionJSON): PushSubscription =>
	({ toJSON: () => json }) as unknown as PushSubscription;

describe('persistExistingWebPushSubscription', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('saves a provided subscription without requesting notification permission', async () => {
		const requestPermission = vi.fn().mockRejectedValue(new Error('permission prompt blocked'));
		vi.stubGlobal('Notification', { requestPermission });
		const subscription = pushSubscriptionFromJson({
			endpoint: 'https://push.example.test/subscription-1',
			keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
		});
		apiMock.apiFetch.mockResolvedValue({ ok: true, data: { ok: true } });

		await persistExistingWebPushSubscription('WG/123?x=1', 'member-1', subscription);

		expect(requestPermission).not.toHaveBeenCalled();
		expect(apiMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/notifications', {
			method: 'POST',
			memberId: 'member-1',
			body: JSON.stringify({
				action: 'push_subscribe',
				endpoint: 'https://push.example.test/subscription-1',
				p256dh: 'p256dh-key',
				authKey: 'auth-key',
			}),
		});
	});

	it('preserves retryable save errors for a provided subscription', async () => {
		const subscription = pushSubscriptionFromJson({
			endpoint: 'https://push.example.test/subscription-1',
			keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
		});
		apiMock.apiFetch.mockResolvedValue({ ok: false, status: 500, error: 'unexpected_error' });

		await expect(
			persistExistingWebPushSubscription('MTE8PZAT', 'member-1', subscription),
		).rejects.toThrow('Push-Abo konnte nicht gespeichert werden: Versuche es gleich erneut.');
	});
});

describe('unsubscribeWebPush', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('unsubscribes locally and saves the server opt-out', async () => {
		const unsubscribe = vi.fn().mockResolvedValue(true);
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				ready: Promise.resolve({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue({
							endpoint: 'https://push.example.test/subscription-1',
							unsubscribe,
						}),
					},
				}),
			},
		});
		apiMock.apiFetch.mockResolvedValue({ ok: true, data: { ok: true } });

		await expect(unsubscribeWebPush('MTE8PZAT', 'member-1')).resolves.toBeUndefined();

		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(apiMock.apiFetch).toHaveBeenCalledWith('/api/wg/MTE8PZAT/notifications', {
			method: 'POST',
			memberId: 'member-1',
			body: JSON.stringify({
				action: 'push_unsubscribe',
				endpoint: 'https://push.example.test/subscription-1',
			}),
		});
		const [serverCallOrder] = apiMock.apiFetch.mock.invocationCallOrder;
		const [browserCallOrder] = unsubscribe.mock.invocationCallOrder;
		expect(serverCallOrder).toBeDefined();
		expect(browserCallOrder).toBeDefined();
		expect(serverCallOrder as number).toBeLessThan(browserCallOrder as number);
	});

	it('encodes the WG code while saving the server opt-out', async () => {
		const unsubscribe = vi.fn().mockResolvedValue(true);
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				ready: Promise.resolve({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue({
							endpoint: 'https://push.example.test/subscription-1',
							unsubscribe,
						}),
					},
				}),
			},
		});
		apiMock.apiFetch.mockResolvedValue({ ok: true, data: { ok: true } });

		await unsubscribeWebPush('WG/123?x=1', 'member-1');

		expect(apiMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/notifications', {
			method: 'POST',
			memberId: 'member-1',
			body: JSON.stringify({
				action: 'push_unsubscribe',
				endpoint: 'https://push.example.test/subscription-1',
			}),
		});
	});

	it('explains retryable server failures when the server unsubscribe cannot be saved', async () => {
		const unsubscribe = vi.fn().mockResolvedValue(true);
		const subscription = {
			endpoint: 'https://push.example.test/subscription-1',
			unsubscribe,
		};
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				ready: Promise.resolve({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue(subscription),
					},
				}),
			},
		});
		apiMock.apiFetch.mockResolvedValue({ ok: false, status: 500, error: 'unexpected_error' });

		await expect(unsubscribeWebPush('MTE8PZAT', 'member-1')).rejects.toThrow(
			'Push-Abo konnte nicht deaktiviert werden: Versuche es gleich erneut.',
		);
		expect(unsubscribe).not.toHaveBeenCalled();
		expect(apiMock.apiFetch).toHaveBeenCalledWith('/api/wg/MTE8PZAT/notifications', {
			method: 'POST',
			memberId: 'member-1',
			body: JSON.stringify({
				action: 'push_unsubscribe',
				endpoint: 'https://push.example.test/subscription-1',
			}),
		});
	});

	it('explains stale membership when the server opt-out is denied', async () => {
		const unsubscribe = vi.fn().mockResolvedValue(true);
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				ready: Promise.resolve({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue({
							endpoint: 'https://push.example.test/subscription-1',
							unsubscribe,
						}),
					},
				}),
			},
		});
		apiMock.apiFetch.mockResolvedValue({ ok: false, status: 404, error: 'member_not_found' });

		await expect(unsubscribeWebPush('MTE8PZAT', 'member-1')).rejects.toThrow(
			'Push-Abo konnte nicht deaktiviert werden: Tritt der WG erneut bei.',
		);
		expect(unsubscribe).not.toHaveBeenCalled();
	});

	it('treats server opt-out as successful when local unsubscribe fails', async () => {
		const unsubscribe = vi.fn().mockRejectedValue(new Error('browser unsubscribe failed'));
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				ready: Promise.resolve({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue({
							endpoint: 'https://push.example.test/subscription-1',
							unsubscribe,
						}),
					},
				}),
			},
		});
		apiMock.apiFetch.mockResolvedValue({ ok: true, data: { ok: true } });

		await expect(unsubscribeWebPush('MTE8PZAT', 'member-1')).resolves.toBeUndefined();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it('falls back to a server-only opt-out when no local push subscription exists', async () => {
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				ready: Promise.resolve({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue(null),
					},
				}),
			},
		});
		apiMock.apiFetch.mockResolvedValue({ ok: true, data: { ok: true } });

		await expect(unsubscribeWebPush('MTE8PZAT', 'member-1')).resolves.toBeUndefined();
		expect(apiMock.apiFetch).toHaveBeenCalledWith('/api/wg/MTE8PZAT/notifications', {
			method: 'PATCH',
			memberId: 'member-1',
			body: JSON.stringify({ pushOptIn: false }),
		});
	});

	it('falls back to a server-only opt-out when service workers are unavailable during unsubscribe', async () => {
		const originalNavigator = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
		if (originalNavigator) {
			Object.defineProperty(navigator, 'serviceWorker', {
				configurable: true,
				value: undefined,
			});
		}
		apiMock.apiFetch.mockResolvedValue({ ok: true, data: { ok: true } });

		await expect(unsubscribeWebPush('MTE8PZAT', 'member-1')).resolves.toBeUndefined();
		expect(apiMock.apiFetch).toHaveBeenCalledWith('/api/wg/MTE8PZAT/notifications', {
			method: 'PATCH',
			memberId: 'member-1',
			body: JSON.stringify({ pushOptIn: false }),
		});

		if (originalNavigator) Object.defineProperty(navigator, 'serviceWorker', originalNavigator);
	});
});

describe('subscribeWebPush', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'AQID');
		vi.stubGlobal('Notification', {
			requestPermission: vi.fn().mockResolvedValue('granted'),
		});
		vi.stubGlobal('PushManager', class PushManager {});
	});

	it('explains retryable server failures and cleans up a newly created browser subscription when the server save fails', async () => {
		const unsubscribe = vi.fn().mockResolvedValue(true);
		const subscription = {
			toJSON: () => ({
				endpoint: 'https://push.example.test/subscription-1',
				keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
			}),
			unsubscribe,
		};
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				ready: Promise.resolve({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue(null),
						subscribe: vi.fn().mockResolvedValue(subscription),
					},
				}),
			},
		});
		apiMock.apiFetch.mockResolvedValue({ ok: false, status: 500, error: 'unexpected_error' });

		await expect(subscribeWebPush('MTE8PZAT', 'member-1')).rejects.toThrow(
			'Push-Abo konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(apiMock.apiFetch).toHaveBeenCalledWith('/api/wg/MTE8PZAT/notifications', {
			method: 'POST',
			memberId: 'member-1',
			body: JSON.stringify({
				action: 'push_subscribe',
				endpoint: 'https://push.example.test/subscription-1',
				p256dh: 'p256dh-key',
				authKey: 'auth-key',
			}),
		});
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it('explains stale membership when the server opt-in is denied and cleans up the browser subscription', async () => {
		const unsubscribe = vi.fn().mockResolvedValue(true);
		const subscription = {
			toJSON: () => ({
				endpoint: 'https://push.example.test/subscription-1',
				keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
			}),
			unsubscribe,
		};
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				ready: Promise.resolve({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue(null),
						subscribe: vi.fn().mockResolvedValue(subscription),
					},
				}),
			},
		});
		apiMock.apiFetch.mockResolvedValue({ ok: false, status: 404, error: 'member_not_found' });

		await expect(subscribeWebPush('MTE8PZAT', 'member-1')).rejects.toThrow(
			'Push-Abo konnte nicht gespeichert werden: Tritt der WG erneut bei.',
		);
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it('encodes the WG code while saving the server opt-in', async () => {
		const subscription = {
			toJSON: () => ({
				endpoint: 'https://push.example.test/subscription-1',
				keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
			}),
			unsubscribe: vi.fn().mockResolvedValue(true),
		};
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				ready: Promise.resolve({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue(subscription),
					},
				}),
			},
		});
		apiMock.apiFetch.mockResolvedValue({ ok: true, data: { ok: true } });

		await subscribeWebPush('WG/123?x=1', 'member-1');

		expect(apiMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/notifications', {
			method: 'POST',
			memberId: 'member-1',
			body: JSON.stringify({
				action: 'push_subscribe',
				endpoint: 'https://push.example.test/subscription-1',
				p256dh: 'p256dh-key',
				authKey: 'auth-key',
			}),
		});
	});

	it('explains invalid server-side push subscription bodies and cleans up the browser subscription', async () => {
		const unsubscribe = vi.fn().mockResolvedValue(true);
		const subscription = {
			toJSON: () => ({
				endpoint: 'https://push.example.test/subscription-1',
				keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
			}),
			unsubscribe,
		};
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				ready: Promise.resolve({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue(null),
						subscribe: vi.fn().mockResolvedValue(subscription),
					},
				}),
			},
		});
		apiMock.apiFetch.mockResolvedValue({
			ok: false,
			status: 400,
			error: 'push_subscription_invalid',
		});

		await expect(subscribeWebPush('MTE8PZAT', 'member-1')).rejects.toThrow(
			'Push-Abo konnte nicht gespeichert werden: Aktiviere Web Push neu.',
		);
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it('cleans up a newly created browser subscription when it cannot be read', async () => {
		const unsubscribe = vi.fn().mockResolvedValue(true);
		const subscription = {
			toJSON: () => ({ endpoint: 'https://push.example.test/subscription-1', keys: {} }),
			unsubscribe,
		};
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				ready: Promise.resolve({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue(null),
						subscribe: vi.fn().mockResolvedValue(subscription),
					},
				}),
			},
		});

		await expect(subscribeWebPush('MTE8PZAT', 'member-1')).rejects.toThrow(
			'Push-Abo konnte nicht gelesen werden.',
		);
		expect(apiMock.apiFetch).not.toHaveBeenCalled();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});
});
