'use client';

import { MEMBERSHIP_LOST_EVENT } from '@/core/infra/api-client';
import { type StoredIdentity, clearIdentity } from '@/core/auth/identity';
import { type Dispatch, type RefObject, type SetStateAction, useEffect } from 'react';

/**
 * Any API call can discover that this member was removed or left, or that the
 * share code rotated (404 wg_not_found on the old code).
 */
export function useMembershipLost({
	wgId,
	encodedShareCode,
	authGenerationRef,
	syncAbortRef,
	setStateIdentity,
	setIsAdmin,
	setAccountReady,
	setMemberLoaded,
}: {
	wgId: string;
	encodedShareCode: string;
	authGenerationRef: RefObject<number>;
	syncAbortRef: RefObject<AbortController | null>;
	setStateIdentity: Dispatch<SetStateAction<StoredIdentity | null>>;
	setIsAdmin: (isAdmin: boolean) => void;
	setAccountReady: (accountReady: boolean) => void;
	setMemberLoaded: (memberLoaded: boolean) => void;
}): void {
	useEffect(() => {
		let handling = false;
		const onLost = (event: Event) => {
			const { path = '', error } =
				(event as CustomEvent<{ path?: string; error?: string }>).detail ?? {};
			if (!path.startsWith(`/api/wg/${encodedShareCode}`) || handling) return;
			handling = true;
			authGenerationRef.current += 1;
			syncAbortRef.current?.abort();
			syncAbortRef.current = null;
			const showLost = () => {
				clearIdentity(wgId);
				setStateIdentity(null);
				setIsAdmin(false);
				setAccountReady(false);
				setMemberLoaded(true);
			};
			if (error !== 'wg_not_found') return showLost();
			// Same WG under a new code: follow it instead of leaving a broken page.
			setMemberLoaded(false);
			void fetch('/api/wg/mine', { cache: 'no-store' })
				.then((res) => (res.ok ? res.json() : null))
				.then((data: { wgs?: Array<{ id: string; code: string }> } | null) => {
					const next = data?.wgs?.find((entry) => entry.id === wgId)?.code;
					if (!next) return showLost();
					const { pathname, search } = window.location;
					window.location.replace(
						pathname.replace(`/wg/${encodedShareCode}`, `/wg/${encodeURIComponent(next)}`) + search,
					);
				})
				.catch(showLost);
		};
		window.addEventListener(MEMBERSHIP_LOST_EVENT, onLost);
		return () => window.removeEventListener(MEMBERSHIP_LOST_EVENT, onLost);
	}, [
		authGenerationRef,
		encodedShareCode,
		setAccountReady,
		setIsAdmin,
		setMemberLoaded,
		setStateIdentity,
		syncAbortRef,
		wgId,
	]);
}
