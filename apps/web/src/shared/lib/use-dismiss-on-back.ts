'use client';

import { type RefObject, useEffect } from 'react';

interface OverlayCloseActions {
	close: () => void;
}

interface CloseWatcherLike {
	onclose: (() => void) | null;
	destroy: () => void;
}

interface OverlayEntry {
	id: number;
	close: () => void;
}

// Open overlays, innermost last. Each owns one history entry, so a back press
// pops exactly the topmost one (nested sheets stack).
const stack: OverlayEntry[] = [];
let nextId = 0;
// Number of popstates caused by our own history.back() that must be ignored.
let ownPops = 0;
let listening = false;
// Markers of overlays that were closed through the UI and still sit in history, innermost on
// top. They are popped one by one (a back() settles asynchronously) by a single deferred pass,
// so nested overlays closing together (form + discard confirmation) leave no entry behind.
const closedMarkers = new Set<number>();
let popTimer: ReturnType<typeof setTimeout> | undefined;
const settledCallbacks: Array<() => void> = [];
const POP_DELAY_MS = 50;
// A pop that never reports back must not hold a waiting caller forever.
const SETTLE_TIMEOUT_MS = 1000;
// When an overlay action starts a navigation, the router replaces the marker
// entry itself once the new route has loaded. That can take longer than any
// fixed delay on a slow device, so the cleanup must not pop the entry in the
// meantime: a back() during the pending navigation cancels it.
let navigationStartedAt = 0;
const NAVIGATION_GRACE_MS = 5000;

/** Call right before `router.push`/`router.replace` from inside an overlay action. */
export function markOverlayNavigation(): void {
	navigationStartedAt = Date.now();
}

export function overlayNavigationPending(): boolean {
	return Date.now() - navigationStartedAt < NAVIGATION_GRACE_MS;
}

// Pops the topmost closed marker; once none is left (or the router owns the history), the callers
// waiting for a settled history run.
function popClosedMarker() {
	const id: unknown = window.history.state?.overlayId;
	if (typeof id === 'number' && closedMarkers.delete(id) && !overlayNavigationPending()) {
		ownPops++;
		window.history.back();
		return;
	}
	closedMarkers.clear();
	for (const callback of settledCallbacks.splice(0)) callback();
}

/**
 * Runs `callback` once the closing overlays have given their marker entries back to history, so
 * the current entry is the one underneath them again. A caller that rewrites the URL after
 * closing an overlay (dropping a `?new=1` parameter) replaces the original entry that way
 * instead of the topmost marker, which would leave the old URL one Back press away.
 */
export function afterOverlayHistorySettled(callback: () => void): void {
	if (popTimer === undefined && ownPops === 0) {
		callback();
		return;
	}
	let done = false;
	const run = () => {
		if (done) return;
		done = true;
		clearTimeout(fallback);
		callback();
	};
	const fallback = setTimeout(run, SETTLE_TIMEOUT_MS);
	settledCallbacks.push(run);
}

function onPopState() {
	if (ownPops > 0) {
		ownPops--;
		if (ownPops === 0) popClosedMarker();
		return;
	}
	// The browser already left the entry; the overlay only has to close.
	stack.pop()?.close();
}

/**
 * Back button / iOS edge swipe / Android back closes the topmost open overlay
 * (dialog, alert dialog, drawer) instead of leaving the page, so a typed draft
 * survives. Each overlay pushes one marker history entry while open (state is
 * copied so Next's router keeps recognising it) and removes it again when it is
 * closed through the UI. CloseWatcher (Android Chromium) additionally routes
 * the system gesture to the overlay without history traversal; the cleanup then
 * drops the marker entry. Touch-only for CloseWatcher: with a keyboard, Base UI
 * already owns Escape.
 *
 * A navigation started while the overlay closes (e.g. "Discard" → router.replace)
 * replaces the marker entry once it commits; the caller announces it through
 * `markOverlayNavigation` so no back() is issued while it is pending.
 *
 * Overlays that close together pop their markers one after the other. Known limit: closing an
 * outer overlay while an inner one stays open leaves a stale entry.
 */
export function useDismissOnBack(
	open: boolean,
	actionsRef: RefObject<OverlayCloseActions | null>,
): void {
	// actionsRef is a stable ref object; only `open` should retrigger this.
	// biome-ignore lint/correctness/useExhaustiveDependencies: actionsRef is stable
	useEffect(() => {
		if (!open) return;
		const entry: OverlayEntry = { id: ++nextId, close: () => actionsRef.current?.close() };
		stack.push(entry);
		window.history.pushState({ ...window.history.state, overlayId: entry.id }, '');
		if (!listening) {
			listening = true;
			window.addEventListener('popstate', onPopState);
		}

		const Watcher = (window as Window & { CloseWatcher?: new () => CloseWatcherLike }).CloseWatcher;
		let watcher: CloseWatcherLike | undefined;
		if (Watcher && window.matchMedia('(pointer: coarse)').matches) {
			watcher = new Watcher();
			watcher.onclose = () => entry.close();
		}

		return () => {
			watcher?.destroy();
			const i = stack.indexOf(entry);
			if (i < 0) return; // popped by the browser already
			stack.splice(i, 1);
			closedMarkers.add(entry.id);
			// Defer so a navigation started by the same click can replace the state first.
			popTimer ??= setTimeout(() => {
				popTimer = undefined;
				popClosedMarker();
			}, POP_DELAY_MS);
		};
	}, [open]);
}
