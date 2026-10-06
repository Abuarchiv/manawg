'use client';

import { useSyncExternalStore } from 'react';

/**
 * The one place that listens to the browser's connectivity (`online`/`offline`) and page
 * visibility (`visibilitychange`). Hooks and components subscribe here instead of adding their
 * own window/document listeners, so every consumer sees the same events in the same order and
 * a single listener pair serves the whole app.
 */

type Listener<T> = (value: T) => void;

interface SharedSubscription<T> {
	listeners: Set<Listener<T>>;
	detach: (() => void) | null;
}

const connectivity: SharedSubscription<boolean> = { listeners: new Set(), detach: null };
const visibility: SharedSubscription<boolean> = { listeners: new Set(), detach: null };

function isOnline(): boolean {
	return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function emit<T>(subscription: SharedSubscription<T>, value: T): void {
	// A listener may unsubscribe (or subscribe another) while the event is being delivered.
	for (const listener of [...subscription.listeners]) listener(value);
}

function addListener<T>(
	subscription: SharedSubscription<T>,
	listener: Listener<T>,
	attach: () => (() => void) | null,
): () => void {
	subscription.listeners.add(listener);
	if (!subscription.detach) subscription.detach = attach();
	return () => {
		subscription.listeners.delete(listener);
		if (subscription.listeners.size > 0) return;
		subscription.detach?.();
		subscription.detach = null;
	};
}

/** Every connectivity change: `true` on `online`, `false` on `offline`. */
export function subscribeConnectivity(listener: Listener<boolean>): () => void {
	return addListener(connectivity, listener, () => {
		if (typeof window === 'undefined') return null;
		const onOnline = () => emit(connectivity, true);
		const onOffline = () => emit(connectivity, false);
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		return () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
		};
	});
}

/** Fires when the browser regains its connection. */
export function subscribeOnline(listener: () => void): () => void {
	return subscribeConnectivity((online) => {
		if (online) listener();
	});
}

/** Every visibility change of the document: `true` when the tab became visible. */
export function subscribeVisibility(listener: Listener<boolean>): () => void {
	return addListener(visibility, listener, () => {
		if (typeof document === 'undefined') return null;
		const onChange = () => emit(visibility, !document.hidden);
		document.addEventListener('visibilitychange', onChange);
		return () => document.removeEventListener('visibilitychange', onChange);
	});
}

const subscribeOnlineStatus = (onChange: () => void) => subscribeConnectivity(onChange);

/** `navigator.onLine` as render state; the server render assumes online. */
export function useOnlineStatus(): boolean {
	return useSyncExternalStore(subscribeOnlineStatus, isOnline, () => true);
}
