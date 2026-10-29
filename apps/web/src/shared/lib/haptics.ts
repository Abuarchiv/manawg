/** Haptic feedback through the Vibration API; a no-op without navigator.vibrate (most desktops, iOS Safari) and with prefers-reduced-motion. */

type HapticIntent = 'light' | 'medium' | 'heavy' | 'selection';

const PATTERNS: Readonly<Record<HapticIntent, number | readonly number[]>> = {
	light: 15,
	medium: 25,
	heavy: 40,
	selection: [10, 30, 10],
};

function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || !window.matchMedia) return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function haptic(intent: HapticIntent = 'light'): void {
	if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
	if (prefersReducedMotion()) return;
	const pattern = PATTERNS[intent];
	try {
		navigator.vibrate(pattern as number | number[]);
	} catch {
		// vibrate can throw on some browsers when called from non-user gesture
	}
}
