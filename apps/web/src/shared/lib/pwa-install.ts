'use client';

/**
 * Global single source of truth for the `beforeinstallprompt` event.
 *
 * The browser fires the event only ONCE per page load. Without a global cache,
 * late-mounting components would lose the event entirely, or several
 * listeners would fight over consuming it.
 *
 * This module registers the listener as early as possible (module top level
 * in the browser) and caches the event on `window` AND in a pub/sub set, so
 * every consumer receives it, whenever it subscribes.
 */

export type BeforeInstallEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type Subscriber = (event: BeforeInstallEvent | null) => void;

declare global {
	interface Window {
		__manawgDeferredInstallEvent?: BeforeInstallEvent | null;
	}

	interface Navigator {
		standalone?: boolean;
	}
}

const subscribers = new Set<Subscriber>();
let cached: BeforeInstallEvent | null = null;
let installed = false;
let initialized = false;

function notify() {
	for (const fn of subscribers) fn(cached);
}

function init() {
	if (initialized) return;
	if (typeof window === 'undefined') return;
	initialized = true;

	// In case it already fired before this module loaded (e.g. via inline script in layout)
	if (window.__manawgDeferredInstallEvent) {
		cached = window.__manawgDeferredInstallEvent as BeforeInstallEvent;
	}

	// Bridge from the inline-script custom event (for subscriber notifications)
	window.addEventListener('manawg:install-ready', () => {
		const ev = window.__manawgDeferredInstallEvent as BeforeInstallEvent | null;
		if (ev) {
			cached = ev;
			notify();
		}
	});

	window.addEventListener('beforeinstallprompt', (e: Event) => {
		e.preventDefault();
		cached = e as BeforeInstallEvent;
		window.__manawgDeferredInstallEvent = cached;
		notify();
	});

	window.addEventListener('appinstalled', () => {
		installed = true;
		cached = null;
		window.__manawgDeferredInstallEvent = null;
		notify();
	});

	// If already standalone (app already installed)
	if (
		window.matchMedia?.('(display-mode: standalone)').matches ||
		window.navigator.standalone === true
	) {
		installed = true;
	}
}

if (typeof window !== 'undefined') {
	init();
}

export function isAppInstalled(): boolean {
	return installed;
}

export function isIosLikeDevice(input: {
	userAgent: string;
	platform?: string;
	maxTouchPoints?: number;
}): boolean {
	const userAgent = input.userAgent.toLowerCase();
	return (
		/iphone|ipad|ipod/.test(userAgent) ||
		(input.platform === 'MacIntel' && (input.maxTouchPoints ?? 0) > 1)
	);
}

export function subscribeInstall(fn: Subscriber): () => void {
	subscribers.add(fn);
	// Call immediately with the current state
	fn(cached);
	return () => {
		subscribers.delete(fn);
	};
}

/**
 * Triggers the native install prompt. Returns:
 *  - 'accepted' / 'dismissed': the user decided
 *  - 'unavailable': the browser delivered no event (PWA criteria not met
 *    or the browser has no native prompt, e.g. iOS Safari)
 */
export async function triggerInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
	const ev = cached;
	if (!ev) return 'unavailable';
	try {
		await ev.prompt();
		const choice = await ev.userChoice;
		// Discard the event after consumption; the browser does not fire it again
		cached = null;
		window.__manawgDeferredInstallEvent = null;
		notify();
		return choice.outcome;
	} catch {
		return 'unavailable';
	}
}
