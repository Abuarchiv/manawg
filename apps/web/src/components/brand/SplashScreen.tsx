'use client';

import { LogoMark } from '@/components/ui/LogoMark';
import { SPLASH_DURATION_MS, SPLASH_FADE_MS } from '@/shared/lib/splash';
import { useEffect, useState } from 'react';

/**
 * Cold-start overlay. It is part of the SSR HTML so the app never flashes underneath;
 * the bootstrap script sets html[data-splash=off] before paint when it must not show
 * (already shown in this tab, or fixture build) and globals.css hides it then.
 */
export function SplashScreen() {
	const [phase, setPhase] = useState<'show' | 'fade' | 'gone'>('show');
	useEffect(() => {
		if (document.documentElement.dataset.splash === 'off') {
			setPhase('gone');
			return;
		}
		// Reduced motion: the final mark is static, so keep it only briefly.
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const show = reduced ? 400 : SPLASH_DURATION_MS;
		const fade = setTimeout(() => setPhase('fade'), show);
		const gone = setTimeout(() => setPhase('gone'), show + SPLASH_FADE_MS);
		return () => {
			clearTimeout(fade);
			clearTimeout(gone);
		};
	}, []);
	if (phase === 'gone') return null;
	return (
		<div
			data-splash-overlay
			aria-hidden="true"
			inert
			style={{
				transition: `opacity ${SPLASH_FADE_MS}ms ease-out`,
				opacity: phase === 'fade' ? 0 : 1,
			}}
			className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0a]"
		>
			<LogoMark size={96} tile={false} grow aria-hidden className="text-white" />
		</div>
	);
}
