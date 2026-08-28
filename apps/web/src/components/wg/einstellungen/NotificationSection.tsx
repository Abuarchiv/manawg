'use client';

import { Section } from '@/components/wg/einstellungen/Section';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import {
	notificationSaveErrorMessage,
	notificationTestErrorMessage,
} from '@/core/guards/settings-errors';
import { apiFetch } from '@/core/infra/api-client';
import { parseQuietHour } from '@/core/notifications/notification-preferences';
import {
	persistExistingWebPushSubscription,
	subscribeWebPush,
	unsubscribeWebPush,
} from '@/core/notifications/push-subscribe';
import {
	formatPushActivationError,
	formatPushDeactivationError,
} from '@/core/notifications/web-push-errors';
import { haptic } from '@manawg/shared/lib/haptics';
import { Bell, CheckCircle2, Loader2, Smartphone } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
	value: hour,
	label: `${String(hour).padStart(2, '0')}:00`,
}));

interface NotificationStatus {
	pushOptIn: boolean;
	notifyAnnouncements: boolean;
	notifyChores: boolean;
	notifyExpenses: boolean;
	notifyReminders: boolean;
	notifyShopping: boolean;
	notifyChat: boolean;
	notifyEvents: boolean;
	quietStartHour: number | null;
	quietEndHour: number | null;
	pushConfigured: boolean;
}

type NotificationPreferenceKey =
	| 'notifyAnnouncements'
	| 'notifyChores'
	| 'notifyExpenses'
	| 'notifyReminders'
	| 'notifyShopping'
	| 'notifyChat'
	| 'notifyEvents';

const NOTIFICATION_PREFERENCES: ReadonlyArray<{
	key: NotificationPreferenceKey;
	label: string;
	description: string;
}> = [
	{
		key: 'notifyAnnouncements',
		label: 'Pinnwand',
		description: 'Beiträge, Antworten, Reaktionen und geklärte Sachen',
	},
	{ key: 'notifyChores', label: 'Putzplan', description: 'Fällige Aufgaben und Erinnerungen' },
	{ key: 'notifyExpenses', label: 'Ausgaben', description: 'Neue gemeinsame Kosten' },
	{ key: 'notifyReminders', label: 'Mahnungen', description: 'Erinnerungen an offene Aufgaben' },
	{ key: 'notifyShopping', label: 'Einkauf', description: 'Neue Einträge auf der Einkaufsliste' },
	{ key: 'notifyChat', label: 'Chat', description: 'Neue Nachrichten und Erwähnungen' },
	{ key: 'notifyEvents', label: 'Termine', description: 'Kalendertermine und Erinnerungen' },
];

export function NotificationSection({ code, memberId }: { code: string; memberId: string }) {
	const [status, setStatus] = useState<NotificationStatus | null>(null);
	const [pending, setPending] = useState<'push' | 'save' | 'test' | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loadingStatus, setLoadingStatus] = useState(true);
	const pendingRef = useRef(false);
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
				getWgLoadErrorMessage('Benachrichtigungen', res.status, res.error, {
					verb: 'konnten',
				}),
			);
		}
		setLoadingStatus(false);
	}, [encodedCode, memberId]);

	useEffect(() => {
		void loadStatus();
	}, [loadStatus]);

	// Reconcile server opt-in when the browser still has a live push subscription.
	useEffect(() => {
		let cancelled = false;
		async function syncPushSubscriptionState(): Promise<void> {
			if (status?.pushOptIn !== false) return;
			const resyncKey = `${code}:${memberId}`;
			if (pushResyncAttemptedKeyRef.current === resyncKey) return;
			pushResyncAttemptedKeyRef.current = resyncKey;
			if (typeof window === 'undefined') return;
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
				if (!cancelled) setError(formatPushActivationError(err));
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
			setMessage('Web Push ist aktiv.');
		} catch (err) {
			setError(formatPushActivationError(err));
		} finally {
			pendingRef.current = false;
			setPending(null);
		}
	}

	async function deactivatePush() {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending('push');
		setError(null);
		try {
			await unsubscribeWebPush(code, memberId);
			setStatus((prev) => (prev ? { ...prev, pushOptIn: false } : prev));
			setMessage('Web Push ist deaktiviert.');
		} catch (err) {
			setError(formatPushDeactivationError(err));
		} finally {
			pendingRef.current = false;
			setPending(null);
		}
	}

	async function togglePreference(key: NotificationPreferenceKey): Promise<void> {
		if (!status || pendingRef.current) return;
		haptic('selection');
		pendingRef.current = true;
		setPending('save');
		setError(null);
		try {
			const next = !status[key];
			setStatus({ ...status, [key]: next });
			const res = await apiFetch<{ ok: true }>(`/api/wg/${encodedCode}/notifications`, {
				method: 'PATCH',
				memberId,
				body: JSON.stringify({ [key]: next }),
			});
			if (!res.ok) {
				setStatus(status);
				setError(notificationSaveErrorMessage(res.status, res.error));
			}
		} finally {
			pendingRef.current = false;
			setPending(null);
		}
	}

	async function saveQuietHours(startHour: number | null, endHour: number | null): Promise<void> {
		if (!status || pendingRef.current) return;
		pendingRef.current = true;
		setPending('save');
		setError(null);
		try {
			const previous = status;
			setStatus({ ...status, quietStartHour: startHour, quietEndHour: endHour });
			const res = await apiFetch<{ ok: true }>(`/api/wg/${encodedCode}/notifications`, {
				method: 'PATCH',
				memberId,
				body: JSON.stringify({ quietStartHour: startHour, quietEndHour: endHour }),
			});
			if (!res.ok) {
				setStatus(previous);
				setError(notificationSaveErrorMessage(res.status, res.error));
			}
		} finally {
			pendingRef.current = false;
			setPending(null);
		}
	}

	async function sendTestNotification(): Promise<void> {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending('test');
		setError(null);
		setMessage(null);
		try {
			const res = await apiFetch<{ ok: true }>(`/api/wg/${encodedCode}/notifications`, {
				method: 'POST',
				memberId,
				body: JSON.stringify({ action: 'test_notification' }),
			});
			if (res.ok) {
				setMessage('Test wurde ausgelöst. Prüfe Push und WG-Chat.');
			} else {
				setError(notificationTestErrorMessage(res.status, res.error));
			}
		} catch {
			setError(notificationTestErrorMessage(0, 'Netzwerkfehler'));
		} finally {
			pendingRef.current = false;
			setPending(null);
		}
	}

	const pushActive = !!status?.pushOptIn;
	const notificationBusy = pending !== null || loadingStatus;
	const notificationControlsDisabled = !status || notificationBusy;
	const pushConfigured = status?.pushConfigured !== false;
	const pushDisabled = notificationControlsDisabled || !pushConfigured;

	return (
		<Section
			id="benachrichtigungen"
			title="Benachrichtigungen"
			hint="Web Push und der WG-Chat halten dich beim Putzplan und bei WG-Aktivität auf dem Laufenden."
		>
			<div className="space-y-4 p-4">
				{loadingStatus && (
					<output className="block text-[12.5px] text-[var(--text-3)]" aria-live="polite">
						Benachrichtigungen werden geladen...
					</output>
				)}
				{!status && error && (
					<div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-3">
						<p role="alert" className="text-[12.5px] text-[var(--danger)]">
							{error}
						</p>
						<button
							type="button"
							onClick={() => void loadStatus()}
							disabled={loadingStatus}
							className="mt-2 inline-flex h-11 items-center justify-center rounded-md border border-[var(--danger)]/30 px-3 text-[12px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
						>
							{loadingStatus ? 'Lädt...' : 'Erneut laden'}
						</button>
					</div>
				)}
				<div className="grid gap-2">
					<ChannelButton
						icon={<Smartphone className="h-4 w-4" aria-hidden />}
						title="Web Push"
						status={!pushConfigured ? 'Nicht konfiguriert' : pushActive ? 'Aktiv' : 'Aktivieren'}
						active={pushActive}
						loading={pending === 'push'}
						disabled={pushDisabled}
						onClick={pushActive ? deactivatePush : activatePush}
					/>
				</div>
				<button
					type="button"
					onClick={() => void sendTestNotification()}
					disabled={notificationControlsDisabled || !pushActive}
					aria-label={
						pending === 'test'
							? 'Testbenachrichtigung wird gesendet'
							: 'Testbenachrichtigung senden'
					}
					className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[13px] font-medium text-[var(--text-1)] transition-colors hover:border-[var(--border-strong)] disabled:opacity-50"
				>
					{pending === 'test' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
					Test senden
				</button>

				<div className="rounded-md border border-[var(--border)]">
					{NOTIFICATION_PREFERENCES.map((pref, index) => (
						<label
							key={pref.key}
							className={`flex cursor-pointer items-center gap-3 px-3 py-3 ${
								index > 0 ? 'border-t border-[var(--border)]' : ''
							}`}
						>
							<input
								type="checkbox"
								checked={status?.[pref.key] ?? true}
								disabled={notificationControlsDisabled}
								onChange={() => void togglePreference(pref.key)}
								className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
							/>
							<span className="min-w-0 flex-1">
								<span className="block text-[13.5px] font-medium text-[var(--text-1)]">
									{pref.label}
								</span>
								<span className="block text-[12px] text-[var(--text-3)]">{pref.description}</span>
							</span>
						</label>
					))}
				</div>

				<div className="grid gap-2 sm:grid-cols-3">
					{[
						['Relevant', 'Nur aktivierte Kategorien werden gesendet.'],
						['Gebündelt', 'Ähnliche WG-Ereignisse werden ruhiger dargestellt.'],
						['Ruhezeit', 'Nachts bleibt alles in der App statt im Sperrbildschirm.'],
					].map(([title, detail]) => (
						<div key={title} className="rounded-md border border-[var(--border)] px-3 py-2">
							<p className="text-[12.5px] font-medium text-[var(--text-1)]">{title}</p>
							<p className="mt-0.5 text-[11.5px] text-[var(--text-3)]">{detail}</p>
						</div>
					))}
				</div>

				<div className="rounded-md border border-[var(--border)] p-3">
					<div className="mb-2 flex items-center justify-between gap-2">
						<div>
							<div className="text-[13.5px] font-medium text-[var(--text-1)]">Ruhezeit</div>
							<div className="text-[12px] text-[var(--text-3)]">
								In dieser Zeit werden Push-Benachrichtigungen pausiert.
							</div>
						</div>
						<button
							type="button"
							onClick={() => void saveQuietHours(null, null)}
							disabled={notificationControlsDisabled}
							className="text-[12px] font-medium text-[var(--text-2)] transition-colors hover:text-[var(--text-1)] disabled:opacity-50"
						>
							Aus
						</button>
					</div>
					<div className="grid grid-cols-2 gap-2">
						<label>
							<span className="mb-1 block text-[12px] text-[var(--text-3)]">Von</span>
							<select
								value={status?.quietStartHour ?? ''}
								disabled={notificationControlsDisabled}
								onChange={(e) => {
									const value = parseQuietHour(e.target.value);
									void (value === null
										? saveQuietHours(null, null)
										: saveQuietHours(value, status?.quietEndHour ?? 7));
								}}
								className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2 text-[13px] text-[var(--text-1)]"
							>
								<option value="">Aus</option>
								{HOUR_OPTIONS.map((option) => (
									<option key={option.label} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
						<label>
							<span className="mb-1 block text-[12px] text-[var(--text-3)]">Bis</span>
							<select
								value={status?.quietEndHour ?? ''}
								disabled={notificationControlsDisabled}
								onChange={(e) => {
									const value = parseQuietHour(e.target.value);
									void (value === null
										? saveQuietHours(null, null)
										: saveQuietHours(status?.quietStartHour ?? 22, value));
								}}
								className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2 text-[13px] text-[var(--text-1)]"
							>
								<option value="">Aus</option>
								{HOUR_OPTIONS.map((option) => (
									<option key={option.label} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
					</div>
				</div>

				{message && (
					<output
						className="flex items-center gap-1.5 text-[12.5px] text-[var(--success-fg)]"
						aria-live="polite"
					>
						<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
						{message}
					</output>
				)}
				{status && error && (
					<p role="alert" className="text-[12.5px] text-[var(--danger)]">
						{error}
					</p>
				)}
			</div>
		</Section>
	);
}

function ChannelButton({
	icon,
	title,
	status,
	active,
	loading,
	disabled,
	onClick,
}: {
	icon: ReactNode;
	title: string;
	status: string;
	active: boolean;
	loading: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled ?? loading}
			aria-pressed={active}
			className={`flex min-h-[64px] items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-60 ${
				active
					? 'border-[var(--success-border)] bg-[var(--success-bg)]'
					: 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface)]'
			}`}
		>
			<span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-1)]">
				{loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
			</span>
			<span className="min-w-0">
				<span className="flex items-center gap-1.5 text-[14px] font-medium text-[var(--text-1)]">
					{title}
					{active && <Bell className="h-3.5 w-3.5 text-[var(--success-fg)]" aria-hidden />}
				</span>
				<span className="mt-0.5 block text-[12px] text-[var(--text-3)]">{status}</span>
			</span>
		</button>
	);
}
