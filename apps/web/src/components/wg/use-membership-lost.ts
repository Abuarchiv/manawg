'use client';

import { type Dispatch, type RefObject, useEffect } from 'react';
import { fetchAccountWgs } from '@/core/infra/account-wgs';
import { MEMBERSHIP_LOST_EVENT } from '@/core/infra/api-client';
import type { WgAuthRef, WgSessionAction } from './wg-session-state';

/**
 * Any API call can discover that this member was removed or left, or that the
 * share code rotated (404 wg_not_found on the old code).
 */
export function useMembershipLost({
	wgId,
	encodedShareCode,
	auth,
	dispatch,
}: {
	wgId: string;
	encodedShareCode: string;
	auth: RefObject<WgAuthRef>;
	dispatch: Dispatch<WgSessionAction>;
}): void {
	useEffect(() => {
		let handling = false;
		const onLost = (event: Event) => {
			const { path = '', error } =
				(event as CustomEvent<{ path?: string; error?: string }>).detail ?? {};
			if (!path.startsWith(`/api/wg/${encodedShareCode}`) || handling) return;
			handling = true;
			auth.current.generation += 1;
			auth.current.syncAbort?.abort();
			auth.current.syncAbort = null;
			const showLost = () => dispatch({ type: 'member-lost' });
			if (error !== 'wg_not_found') return showLost();
			// Same WG under a new code: follow it instead of leaving a broken page.
			dispatch({ type: 'loading' });
			void fetchAccountWgs().then((res) => {
				const next = res.ok ? res.wgs.find((entry) => entry.id === wgId)?.code : undefined;
				if (!next) return showLost();
				const { pathname, search } = window.location;
				window.location.replace(
					pathname.replace(`/wg/${encodedShareCode}`, `/wg/${encodeURIComponent(next)}`) + search,
				);
			});
		};
		window.addEventListener(MEMBERSHIP_LOST_EVENT, onLost);
		return () => window.removeEventListener(MEMBERSHIP_LOST_EVENT, onLost);
	}, [auth, dispatch, encodedShareCode, wgId]);
}
