import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useWg } from '@/components/wg/WgContextProvider';
import { createIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { copyText } from '@/core/utils/clipboard';

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
 * Personal calendar feed. All state is bound to the scope (WG + member) so a late-arriving
 * response after a WG switch does not land in the wrong WG.
 */
export function useCalendarSubscription(encodedShareCode: string) {
	const { identity } = useWg();
	const toast = useToast();
	const t = useTranslations('events.subscription');
	const endpoint = `/api/wg/${encodedShareCode}/calendar-subscription`;
	const scope = `${encodedShareCode}\u0000${identity.memberId}`;
	const scopeRef = useRef(scope);
	scopeRef.current = scope;
	const readRequestIdRef = useRef(0);
	const busyRef = useRef(false);
	const busyScopeRef = useRef<string | null>(null);
	// A failed (not clearly rejected) request is retried with the same key.
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
			setErrorState({ scope: requestedScope, value: t('loadFailed') });
		}
		setLoadingState({ scope: requestedScope, value: false });
	}, [identity.memberId, endpoint, scope, t]);

	useEffect(() => {
		void load();
		const onFocus = () => void load();
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [load]);

	/** Serializes writes and holds back reads in the meantime. */
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
		const idempotencyKey = requestKeysRef.current.get(requestKeyId) ?? createIdempotencyKey();
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

	function releaseKeyUnlessRetryable(requestKeyId: string, status: number, error: string): void {
		if (shouldReleaseIdempotencyKey(status, error)) requestKeysRef.current.delete(requestKeyId);
	}

	async function save(method: 'POST' | 'PATCH', message: string): Promise<void> {
		const requestKeyId = `subscription:${method}`;
		await runExclusive(requestKeyId, t('keyUnavailableSave'), async (idempotencyKey) => {
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
				if (!res.ok) releaseKeyUnlessRetryable(requestKeyId, res.status, res.error);
				setError(t('saveFailed'));
			}
		});
	}

	async function revoke(): Promise<void> {
		const requestKeyId = 'subscription:DELETE';
		await runExclusive(requestKeyId, t('keyUnavailableRevoke'), async (idempotencyKey) => {
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
				setNotice(t('revoked'));
			} else {
				setSubscription(previousSubscription);
				releaseKeyUnlessRetryable(requestKeyId, res.status, res.error);
				setError(t('revokeFailed'));
				toast.error(t('revokeFailed'));
			}
		});
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
		create: () => save('POST', t('created')),
		rotate: () => save('PATCH', t('rotated')),
		revoke,
		copyUrl,
	};
}
