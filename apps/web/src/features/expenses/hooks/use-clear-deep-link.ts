'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { PREFILL_PARAMS } from '@/features/expenses/hooks/use-expense-prefill-handoff';
import { afterOverlayHistorySettled } from '@/shared/lib/use-dismiss-on-back';

/**
 * Removes the deep-link parameters (`?new=1`, prefill) when the form closes (cancel, save): a
 * reload with the form open restores it again, but afterwards it does not reopen unprompted.
 *
 * The closing form and its discard confirmation still own history entries that carry the old URL.
 * The URL is rewritten after they are popped, so it replaces the entry the link opened and
 * system Back goes to the page before the link instead of onto a `?new=1` entry that would
 * reopen the empty form.
 */
export function useClearDeepLinkOnClose(formOpen: boolean): void {
	const router = useRouter();
	const pathname = usePathname();
	const wasOpenRef = useRef(formOpen);
	useEffect(() => {
		const wasOpen = wasOpenRef.current;
		wasOpenRef.current = formOpen;
		if (!wasOpen || formOpen) return;
		afterOverlayHistorySettled(() => {
			// The visitor may have moved on while the entries were popped.
			if (window.location.pathname !== pathname) return;
			const next = new URLSearchParams(window.location.search);
			let changed = false;
			for (const key of PREFILL_PARAMS) {
				if (next.has(key)) {
					next.delete(key);
					changed = true;
				}
			}
			if (!changed) return;
			const query = next.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
		});
	}, [formOpen, router, pathname]);
}
