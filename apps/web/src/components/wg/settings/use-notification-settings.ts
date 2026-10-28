'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	notificationSaveErrorMessage,
	notificationTestErrorMessage,
} from '@/components/wg/settings/settings-errors';
import { wgLoadError } from '@/core/guards/load-errors';
import { NETWORK_ERROR_CODE } from '@/core/http/error-codes';
import { createIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { isPushOptedOut } from '@/core/notifications/push-priming';
import {
	type PushDeviceState,
	persistExistingWebPushSubscription,
	readPushDeviceState,
	subscribeWebPush,
	unsubscribeWebPush,
} from '@/core/notifications/push-subscribe';
import {
	formatPushActivationError,
	formatPushDeactivationError,
} from '@/core/notifications/web-push-errors';
import { useMessage } from '@/shared/i18n/message';
import { haptic } from '@/shared/lib/haptics';

export interface NotificationStatus {
	pushOptIn: boolean;
	notifyAnnouncements: boolean;
	notifyChores: boolean;
	notifyExpenses: boolean;
	notifyReminders: boolean;
	notifyShopping: boolean;
	notifyInventory: boolean;
	notifyChat: boolean;
	notifyEvents: boolean;
	notifyStatementEmail: boolean;
	quietStartHour: number | null;
	quietEndHour: number | null;
	pushConfigured: boolean;
}

export type NotificationPreferenceKey =
	| 'notifyAnnouncements'
	| 'notifyChores'
	| 'notifyExpenses'
	| 'notifyReminders'
	| 'notifyShopping'
	| 'notifyInventory'
	| 'notifyChat'
	| 'notifyEvents'
	| 'notifyStatementEmail';

/** `name` picks the label in `settings.notifications.prefs`, `hint` the line in `prefHints`. */
export const NOTIFICATION_PREFERENCES: ReadonlyArray<{
	key: NotificationPreferenceKey;
	name:
		| 'announcements'
		| 'chores'
		| 'expenses'
		| 'reminders'
		| 'shopping'
		| 'inventory'
		| 'chat'
		| 'events'
		| 'statementEmail';
	hint?: 'reminders' | 'inventory' | 'statementEmail';
}> = [
	{ key: 'notifyAnnouncements', name: 'announcements' },
	{ key: 'notifyChores', name: 'chores' },
	{ key: 'notifyExpenses', name: 'expenses' },
	{ key: 'notifyReminders', name: 'reminders', hint: 'reminders' },
	{ key: 'notifyShopping', name: 'shopping' },
	{ key: 'notifyInventory', name: 'inventory', hint: 'inventory' },
	{ key: 'notifyChat', name: 'chat' },
	{ key: 'notifyEvents', name: 'events' },
	{ key: 'notifyStatementEmail', name: 'statementEmail', hint: 'statementEmail' },
];

interface NotificationSettingsInput {
	code: string;
	memberId: string;
}

/**
 * Notification settings of the member: push subscription, per-area switches and quiet hours.
 * One request at a time; each change carries an idempotency key that survives a retry.
 */
export function useNotificationSettings({ code, memberId }: NotificationSettingsInput) {
	const t = useTranslations('settings.notifications');
	const m = useMessage();
	// `loadStatus` must keep its identity across renders, so it reads the renderer from a ref.
	const renderRef = useRef(m);
	renderRef.current = m;
	const [status, setStatus] = useState<NotificationStatus | null>(null);
	const [pending, setPending] = useState<'push' | 'save' | 'test' | null>(null);
	const [pushTarget, setPushTarget] = useState<boolean | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loadingStatus, setLoadingStatus] = useState(true);
	const [device, setDevice] = useState<PushDeviceState | null>(null);
	const pendingRef = useRef(false);
	const notificationRequestKeysRef = useRef(new Map<string, string>());
	const loadStatusRequestIdRef = useRef(0);
	const pushResyncAttemptedKeyRef = useRef<string | null>(null);
	const encodedCode = encodeURIComponent(code);

	const loadStatus = useCallback(async (): Promise<void> => {
		const requestId = loadStatusRequestIdRef.current + 1;
		loadStatusRequestIdRef.current = requestId;
		setLoadingStatus(true);
		const res = await apiFetch<NotificationStatus>(`/api/wg/${encodedCode}/notifications`, {
			memberId,
		});
		if (requestId !== loadStatusRequestIdRef.current) return;

		if (res.ok) {
			setStatus(res.data);
			setError(null);
		} else {
			setStatus(null);
			setError(
				renderRef.current(
					wgLoadError({ key: 'settings.notifications.loadLead' }, res.status, res.error),
				),
			);
		}
		setLoadingStatus(false);
	}, [encodedCode, memberId]);

	useEffect(() => {
		void loadStatus();
	}, [loadStatus]);

	const refreshDevice = useCallback(async (): Promise<void> => {
		setDevice(await readPushDeviceState());
	}, []);

	useEffect(() => {
		void refreshDevice();
	}, [refreshDevice]);

	// Reconcile server opt-in when the browser still has a live push subscription.
	useEffect(() => {
		let cancelled = false;
		async function syncPushSubscriptionState(): Promise<void> {
			if (status?.pushOptIn !== false) return;
			// An explicit "off" on this device must not be undone by a subscription another WG keeps.
			if (isPushOptedOut(memberId)) return;
			const resyncKey = `${code}:${memberId}`;
			if (pushResyncAttemptedKeyRef.current === resyncKey) return;
			pushResyncAttemptedKeyRef.current = resyncKey;
			if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
			let subscription: PushSubscription | null = null;
			try {
				const registration = await navigator.serviceWorker.getRegistration();
				if (!registration) return;
				const sub = await registration.pushManager.getSubscription();
				if (cancelled) return;
				if (!sub) return;
				subscription = sub;
			} catch {
				return;
			}
			if (!subscription) return;
			try {
				await persistExistingWebPushSubscription(code, memberId, subscription);
				if (cancelled) return;
				setStatus((prev) =>
					prev && prev.pushOptIn === false ? { ...prev, pushOptIn: true } : prev,
				);
			} catch (err) {
				if (!cancelled) setError(renderRef.current(formatPushActivationError(err)));
			}
		}
		void syncPushSubscriptionState();
		return () => {
			cancelled = true;
		};
	}, [code, memberId, status?.pushOptIn]);

	async function activatePush() {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending('push');
		setError(null);
		setMessage(null);
		try {
			await subscribeWebPush(code, memberId);
			setStatus((prev) => (prev ? { ...prev, pushOptIn: true } : prev));
			setMessage(t('pushOn'));
		} catch (err) {
			setError(m(formatPushActivationError(err)));
		} finally {
			pendingRef.current = false;
			setPending(null);
			void refreshDevice();
		}
	}

	async function deactivatePush() {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending('push');
		setError(null);
		setMessage(null);
		try {
			await unsubscribeWebPush(code, memberId);
			pushResyncAttemptedKeyRef.current = `${code}:${memberId}`;
			setStatus((prev) => (prev ? { ...prev, pushOptIn: false } : prev));
			setMessage(t('pushOff'));
		} catch (err) {
			setError(m(formatPushDeactivationError(err)));
		} finally {
			pendingRef.current = false;
			setPending(null);
			void refreshDevice();
		}
	}

	/** Optimistic PATCH of some preferences; rolls back to `previous` when the server refuses. */
	async function patchPreferences(
		body: Partial<NotificationStatus>,
		previous: NotificationStatus,
		keyUnavailableError: string,
	): Promise<void> {
		pendingRef.current = true;
		setPending('save');
		setError(null);
		setMessage(null);
		const requestKeyId = `patch:${JSON.stringify(body)}`;
		const idempotencyKey =
			notificationRequestKeysRef.current.get(requestKeyId) ?? createIdempotencyKey();
		if (!idempotencyKey) {
			pendingRef.current = false;
			setPending(null);
			setError(keyUnavailableError);
			return;
		}
		notificationRequestKeysRef.current.set(requestKeyId, idempotencyKey);
		try {
			setStatus({ ...previous, ...body });
			const res = await apiFetch<{ ok: true }>(`/api/wg/${encodedCode}/notifications`, {
				method: 'PATCH',
				memberId,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				if (shouldReleaseIdempotencyKey(res.status, res.error)) {
					notificationRequestKeysRef.current.delete(requestKeyId);
				}
				setStatus(previous);
				setError(m(notificationSaveErrorMessage(res.status, res.error)));
			} else {
				notificationRequestKeysRef.current.delete(requestKeyId);
			}
		} finally {
			pendingRef.current = false;
			setPending(null);
		}
	}

	async function togglePreference(key: NotificationPreferenceKey): Promise<void> {
		if (!status || pendingRef.current) return;
		haptic('selection');
		await patchPreferences({ [key]: !status[key] }, status, t('errors.keyPreference'));
	}

	async function saveQuietHours(startHour: number | null, endHour: number | null): Promise<void> {
		if (!status || pendingRef.current) return;
		if (startHour !== null && startHour === endHour) {
			setError(t('quietEqual'));
			return;
		}
		await patchPreferences(
			{ quietStartHour: startHour, quietEndHour: endHour },
			status,
			t('errors.keyQuiet'),
		);
	}

	async function sendTestNotification(): Promise<void> {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending('test');
		setError(null);
		setMessage(null);
		const requestKeyId = 'test_notification';
		const idempotencyKey =
			notificationRequestKeysRef.current.get(requestKeyId) ?? createIdempotencyKey();
		if (!idempotencyKey) {
			pendingRef.current = false;
			setPending(null);
			setError(t('errors.keyTest'));
			return;
		}
		notificationRequestKeysRef.current.set(requestKeyId, idempotencyKey);
		try {
			const res = await apiFetch<{ ok: true }>(`/api/wg/${encodedCode}/notifications`, {
				method: 'POST',
				memberId,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({ action: 'test_notification' }),
			});
			if (res.ok) {
				notificationRequestKeysRef.current.delete(requestKeyId);
				setMessage(t('testSent'));
			} else {
				if (shouldReleaseIdempotencyKey(res.status, res.error)) {
					notificationRequestKeysRef.current.delete(requestKeyId);
				}
				setError(m(notificationTestErrorMessage(res.status, res.error)));
				// The server drops dead subscriptions on send; the switch must show that.
				if (res.error === 'no_push_subscription') void loadStatus();
			}
		} catch {
			setError(m(notificationTestErrorMessage(0, NETWORK_ERROR_CODE)));
		} finally {
			pendingRef.current = false;
			setPending(null);
		}
	}

	/** The switch thumb moves at once; after the browser prompt the real state counts. */
	function setPushEnabled(checked: boolean): void {
		if (pendingRef.current) return;
		setPushTarget(checked);
		void (checked ? activatePush() : deactivatePush()).finally(() => setPushTarget(null));
	}

	// The server flag belongs to the member; only a live subscription means this device gets pushes.
	const pushActive = !!status?.pushOptIn && (device === null || device.hasSubscription);
	const pushBlocked = device?.permission === 'denied';

	return {
		status,
		pushActive,
		pushBlocked,
		pending,
		pushTarget,
		message,
		error,
		loadingStatus,
		loadStatus,
		setPushEnabled,
		togglePreference,
		saveQuietHours,
		sendTestNotification,
	};
}
