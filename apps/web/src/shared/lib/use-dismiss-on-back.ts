'use client';

import { type RefObject, useEffect, useRef } from 'react';

const HISTORY_MARKER = 'manawgOverlay';

interface OverlayCloseActions {
	close: () => void;
}

/**
 * WCAG 2.2 / Material 3 predictable navigation: pressing the Android/browser
 * back button while a modal overlay (dialog, alert dialog, drawer) is open
 * should close the overlay instead of leaving the page. Base UI's primitives
 * don't integrate with history on their own, so this pushes one marker entry
 * per open overlay and closes it on `popstate` via the primitive's own
 * imperative `close()` action, rather than letting the browser navigate away.
 *
 * ponytail: nested overlays closed out of open-order (outer before inner) can
 * consume the wrong history entry — rare, most flows close innermost-first.
 * A per-overlay id stack would fix that if it ever surfaces.
 */
export function useDismissOnBack(
	open: boolean,
	actionsRef: RefObject<OverlayCloseActions | null>,
): void {
	const dismissedByBackRef = useRef(false);

	// actionsRef is a stable ref object; only `open` should retrigger this.
	// biome-ignore lint/correctness/useExhaustiveDependencies: actionsRef is stable
	useEffect(() => {
		if (!open || typeof window === 'undefined') return;

		dismissedByBackRef.current = false;
		window.history.pushState({ [HISTORY_MARKER]: true }, '');

		function handlePopState(): void {
			dismissedByBackRef.current = true;
			actionsRef.current?.close();
		}

		window.addEventListener('popstate', handlePopState);
		return () => {
			window.removeEventListener('popstate', handlePopState);
			// Closed some other way (Escape, close button, save) while our
			// marker is still the current entry: consume it so the next back
			// press doesn't land on a dead entry that does nothing.
			const state = window.history.state as Record<string, unknown> | null;
			if (!dismissedByBackRef.current && state?.[HISTORY_MARKER]) {
				window.history.back();
			}
		};
	}, [open]);
}
