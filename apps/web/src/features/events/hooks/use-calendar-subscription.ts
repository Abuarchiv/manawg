import { useToast } from '@/components/ui/Toast';
import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import { copyText } from '@/core/utils/clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface CalendarSubscription {
	feedUrl: string;
	createdAt: string;
	updatedAt: string;
}

interface CalendarSubscriptionResponse {
	subscription: CalendarSubscription | null;
}

type ScopedValue<T> = { scope: string; value: T } | null;

export type SubscriptionConfirm = 'rotate' | 'revoke' | null;

/**
 * Persönlicher Kalender-Feed. Alle Zustände sind an Scope (WG + Mitglied) gebunden, damit eine
 * spät eintreffende Antwort nach einem WG-Wechsel nicht in der falschen WG landet.
 */
export function useCalendarSubscription(encodedShareCode: string) {
	const { identity } = useWg();
	const toast = useToast();
	const endpoint = `/api/wg/${encodedShareCode}/calendar-subscription`;
	const scope = `${encodedShareCode}\u0000${identity.memberId}`;
	const scopeRef = useRef(scope);
	scopeRef.current = scope;
	const readRequestIdRef = useRef(0);
	const busyRef = useRef(false);
	const busyScopeRef = useRef<string | null>(null);
	// Ein fehlgeschlagener (nicht eindeutig abgelehnter) Request wird mit demselben Key wiederholt.
	const requestKeysRef = useRef(new Map<string, string>());

	const [subscriptionRecord, setSubscriptionRecord] =
		useState<ScopedValue<CalendarSubscription | null>>(null);
	const [loadingState, setLoadingState] = useState<ScopedValue<boolean>>(null);
	const [errorState, setErrorState] = useState<ScopedValue<string | null>>(null);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
	const [confirm, setConfirm] = useState<SubscriptionConfirm>(null);

	const subscription = subscriptionRecord?.scope === scope ? subscriptionRecord.value : null;
	const loading = loadingState?.scope !== scope || loadingState.value;
	const error = errorState?.scope === scope ? errorState.value : null;

	function setSubscription(next: CalendarSubscription | null): void {
		setSubscriptionRecord({ scope, value: next });
	}
	function setError(message: string | null): void {
		setErrorState({ scope, value: message });
	}
	function invalidateRead(requestedScope: string): void {
		if (scopeRef.current !== requestedScope) return;
		readRequestIdRef.current += 1;
		setLoadingState({ scope: requestedScope, value: false });
	}

	const load = useCallback(async (): Promise<void> => {
		const requestedScope = scope;
		if (busyScopeRef.current === requestedScope) return;
		const requestId = ++readRequestIdRef.current;
		setLoadingState({ scope: requestedScope, value: true });
		const res = await apiFetch<CalendarSubscriptionResponse>(endpoint, {
			memberId: identity.memberId,
		});
		if (scopeRef.current !== requestedScope || readRequestIdRef.current !== requestId) return;
		if (res.ok) {
			setSubscriptionRecord({ scope: requestedScope, value: res.data.subscription ?? null });
			setErrorState({ scope: requestedScope, value: null });
		} else {
			setErrorState({ scope: requestedScope, value: 'Kalender-Feed konnte nicht geladen werden.' });
		}
		setLoadingState({ scope: requestedScope, value: false });
	}, [identity.memberId, endpoint, scope]);

	useEffect(() => {
		void load();
		const onFocus = () => void load();
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [load]);

	/** Serialisiert Schreibzugriffe und hält Lesezugriffe währenddessen zurück. */
	async function runExclusive(
		requestKeyId: string,
		missingKeyMessage: string,
		run: (idempotencyKey: string) => Promise<void>,
	): Promise<void> {
		if (busyRef.current) return;
		busyRef.current = true;
		const requestedScope = scope;
		busyScopeRef.current = requestedScope;
		invalidateRead(requestedScope);
		setBusy(true);
		setError(null);
		setNotice(null);
		const idempotencyKey =
			requestKeysRef.current.get(requestKeyId) ?? createOfflineIdempotencyKey();
		if (idempotencyKey) {
			requestKeysRef.current.set(requestKeyId, idempotencyKey);
			await run(idempotencyKey);
		} else {
			setError(missingKeyMessage);
		}
		busyRef.current = false;
		busyScopeRef.current = null;
		invalidateRead(requestedScope);
		setBusy(false);
	}

	function releaseKeyUnlessRetryable(requestKeyId: string, status: number): void {
		if (status > 0 && status < 500 && status !== 429) requestKeysRef.current.delete(requestKeyId);
	}

	async function save(method: 'POST' | 'PATCH', message: string): Promise<void> {
		const requestKeyId = `subscription:${method}`;
		await runExclusive(
			requestKeyId,
			'Kalender-Feed konnte nicht sicher gespeichert werden. Versuche es erneut.',
			async (idempotencyKey) => {
				const res = await apiFetch<CalendarSubscriptionResponse>(endpoint, {
					method,
					memberId: identity.memberId,
					headers: { 'Idempotency-Key': idempotencyKey },
				});
				if (res.ok && res.data.subscription) {
					requestKeysRef.current.delete(requestKeyId);
					setSubscription(res.data.subscription);
					setCopyState('idle');
					setNotice(message);
				} else {
					if (!res.ok) releaseKeyUnlessRetryable(requestKeyId, res.status);
					setError('Kalender-Feed konnte nicht gespeichert werden.');
				}
			},
		);
	}

	async function revoke(): Promise<void> {
		const requestKeyId = 'subscription:DELETE';
		await runExclusive(
			requestKeyId,
			'Kalender-Feed konnte nicht sicher widerrufen werden. Versuche es erneut.',
			async (idempotencyKey) => {
				const previousSubscription = subscription;
				setSubscription(null);
				const res = await apiFetch<unknown>(endpoint, {
					method: 'DELETE',
					memberId: identity.memberId,
					headers: { 'Idempotency-Key': idempotencyKey },
				});
				if (res.ok) {
					requestKeysRef.current.delete(requestKeyId);
					setCopyState('idle');
					setNotice('Kalender-Feed widerrufen.');
				} else {
					setSubscription(previousSubscription);
					releaseKeyUnlessRetryable(requestKeyId, res.status);
					setError('Kalender-Feed konnte nicht widerrufen werden.');
					toast.error('Kalender-Feed konnte nicht widerrufen werden.');
				}
			},
		);
	}

	async function copyUrl(): Promise<void> {
		if (!subscription) return;
		setCopyState((await copyText(subscription.feedUrl)) ? 'copied' : 'failed');
	}

	return {
		subscription,
		loading,
		error,
		notice,
		busy,
		copyState,
		confirm,
		setConfirm,
		create: () => save('POST', 'Kalender-Feed erstellt.'),
		rotate: () => save('PATCH', 'Kalender-Feed erneuert.'),
		revoke,
		copyUrl,
	};
}
