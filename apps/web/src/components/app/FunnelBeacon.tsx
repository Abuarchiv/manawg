'use client';

import { useEffect } from 'react';
import { clearFunnelMarker, readFunnelMarker } from '@/core/auth/funnel-marker';
import posthog from '@/shared/lib/analytics';

/**
 * Sends the sign-in step that /auth/callback marked for this page (see funnel-marker.ts). The
 * marker is deleted before the event goes out, so a re-render, StrictMode's second effect run or a
 * reload cannot send it twice.
 */
export function FunnelBeacon() {
	useEffect(() => {
		const marker = readFunnelMarker(document.cookie);
		if (!marker) return;
		// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing in Firefox; the helper builds the fixed value.
		document.cookie = clearFunnelMarker();
		if (marker === 'signup_confirmed') posthog.capture('signup_confirmed');
		else posthog.capture('login_completed');
	}, []);
	return null;
}
