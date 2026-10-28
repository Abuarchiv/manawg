'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isAuthPagePath } from '@/core/auth/auth-intent';
import { safeNextPath } from '@/core/auth/next-path';
import { hasSessionCookie } from '@/core/auth/session-hint';
import { subscribeVisibility } from '@/core/hooks/use-online-status';
import { type AccountWg, fetchAccountWgs } from '@/core/infra/account-wgs';
import { invitePath } from '@/core/utils/invite-token';
import {
	consumeJustSignedIn,
	getNeuIntentFromSearch,
	getWgCodeFromPath,
	markJustSignedIn,
	type StartStep,
} from './start-flow';

export type AuthState = 'loading' | 'signed-out' | 'authenticated' | 'error';

/**
 * Sign-in state and the account's WGs from /api/wg/mine, plus the redirect
 * to `next` (or the only WG) once the account is known.
 */
export function useAccountWgs({
	interactive,
	step,
	clearError,
}: {
	interactive: boolean;
	step: StartStep;
	clearError: () => void;
}) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [accountWgs, setAccountWgs] = useState<AccountWg[]>([]);
	const [authState, setAuthState] = useState<AuthState>('loading');
	const [authRetryNonce, setAuthRetryNonce] = useState(0);
	// A failed-callback notice stays on load; it is dropped only once the visitor signs in here.
	const [signedInHere, setSignedInHere] = useState(false);
	// Client-only: a session cookie exists, so the check is for someone already signed in.
	const [sessionHint, setSessionHint] = useState(false);

	useEffect(() => {
		if (!interactive) return;
		let cancelled = false;
		const loadAccountWgs = async () => {
			if (authRetryNonce > 0) clearError();
			if (!hasSessionCookie()) {
				setAccountWgs([]);
				setAuthState('signed-out');
				return;
			}
			setSessionHint(true);
			setAuthState('loading');
			try {
				const res = await fetchAccountWgs();
				if (cancelled) return;
				if (res.ok) {
					setAccountWgs(res.wgs);
					setAuthState('authenticated');
					return;
				}
				if (res.status === 401) setAccountWgs([]);
				setAuthState(res.status === 401 ? 'signed-out' : 'error');
			} catch {
				if (!cancelled) setAuthState('error');
			}
		};
		void loadAccountWgs();
		return () => {
			cancelled = true;
		};
	}, [authRetryNonce, clearError, interactive]);

	// Another tab signed in or out of this browser's one account: re-check when this tab returns.
	useEffect(() => {
		if (!interactive) return;
		return subscribeVisibility((visible) => {
			if (!visible) return;
			if (authState === 'loading' || authState === 'error') return;
			if (hasSessionCookie() !== (authState === 'authenticated')) setAuthRetryNonce((n) => n + 1);
		});
	}, [authState, interactive]);

	useEffect(() => {
		if (authState !== 'authenticated') return;
		const intent = getNeuIntentFromSearch(searchParams.toString());
		// The invitation page asks for the name; it also sends existing members on to their WG.
		if (intent.inviteToken) {
			router.replace(invitePath(intent.inviteToken));
			return;
		}
		if (intent.create) return;
		// A failed callback stays on this page so its message is seen, not skipped by the redirect.
		if (searchParams.get('error') === 'auth_callback') return;
		const next = safeNextPath(searchParams.get('next'));
		const [onlyWg] = accountWgs;
		// One WG: skip the picker, like the public start page does.
		if (next === '/' || isAuthPagePath(next)) {
			if (consumeJustSignedIn() && accountWgs.length === 1 && onlyWg && step === 'choose') {
				router.replace(`/wg/${encodeURIComponent(onlyWg.code)}`);
			}
			return;
		}
		const nextWgCode = getWgCodeFromPath(next);
		if (nextWgCode && !accountWgs.some((accountWg) => accountWg.code === nextWgCode)) return;
		router.replace(next);
	}, [accountWgs, authState, router, searchParams, step]);

	function retryAuth(): void {
		setAuthRetryNonce((value) => value + 1);
	}

	function handleAuthenticated(): void {
		setSignedInHere(true);
		markJustSignedIn();
		setSessionHint(true);
		setAuthState('loading');
		setAuthRetryNonce((value) => value + 1);
	}

	return {
		accountWgs,
		setAccountWgs,
		authState,
		checkingSession: authState === 'loading' && sessionHint,
		setAuthState,
		retryAuth,
		handleAuthenticated,
		signedInHere,
	};
}
