'use client';

import { captureException } from '@/core/infra/capture-client';
import { useEffect } from 'react';

export function PwaRegister() {
	useEffect(() => {
		if (!('serviceWorker' in navigator)) return;
		if (process.env.NODE_ENV === 'development') {
			// Skip SW in dev to avoid cache surprises during HMR
			return;
		}

		const register = () => {
			// Non-fatal: the site still works without a service worker.
			navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
				captureException(err, { boundary: 'sw-register' });
			});
		};

		if (document.readyState === 'complete') {
			register();
		} else {
			window.addEventListener('load', register, { once: true });
		}
	}, []);

	return null;
}
