'use client';

import { useWg } from '@/components/wg/WgContextProvider';
import { useTabWarmup } from '../_hooks/use-tab-warmup';

/** Renders nothing; warms the tab data and route chunks once the account session is confirmed. */
export function TabWarmup() {
	const { wg, identity, accountReady } = useWg();
	useTabWarmup(encodeURIComponent(wg.shareCode), accountReady ? identity.memberId : undefined);
	return null;
}
