'use client';

import { useEffect } from 'react';

export function PwaRegister() {
	useEffect(() => {
		if (typeof window === 'undefined') return;
		if (!('serviceWorker' in navigator)) return;
		if (process.env.NODE_ENV === 'development') {
			// Skip SW in dev to avoid cache surprises during HMR
			return;
		}

		const serviceWorker = navigator.serviceWorker;

		// sw.js calls skipWaiting()/clients.claim() so a new deploy takes over an
		// already-open tab in the background. That tab's in-memory JS still
		// references the old build's hashed chunk URLs, which 404 once the new
		// SW's activate step evicts the old cache — the app would be stuck until
		// someone thinks to reload by hand. `hadControllerOnLoad` tells a real
		// update (this tab was already controlled) apart from the very first
		// activation of a fresh install (no controller yet, nothing stale to
		// recover from); `reloaded` stops a second event from reload-looping.
		const hadControllerOnLoad = Boolean(serviceWorker.controller);
		let reloaded = false;
		const onControllerChange = () => {
			if (!hadControllerOnLoad || reloaded) return;
			reloaded = true;
			window.location.reload();
		};
		serviceWorker.addEventListener('controllerchange', onControllerChange);

		const register = () => {
			if (typeof serviceWorker.register !== 'function') return;

			serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
				// Non-fatal: site still works without SW
				// eslint-disable-next-line no-console
				console.warn('[manawg] SW registration failed:', err);
			});
		};

		if (document.readyState === 'complete') {
			register();
		} else {
			window.addEventListener('load', register, { once: true });
		}

		return () => {
			serviceWorker.removeEventListener('controllerchange', onControllerChange);
		};
	}, []);

	return null;
}
