'use client';

import { useEffect, useState } from 'react';

/** Threshold: how much smaller than the window the visible area must be to assume an on-screen keyboard. */
const KEYBOARD_MIN_HEIGHT = 100;

/** True while an input has focus and the on-screen keyboard shrinks the visible area. */
export function useKeyboardOpen(): boolean {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const sync = () => {
			const el = document.activeElement;
			const typing =
				el instanceof HTMLElement && el.matches('input, textarea, [contenteditable="true"]');
			setOpen(typing && window.innerHeight - vv.height > KEYBOARD_MIN_HEIGHT);
		};
		// On a field switch, activeElement is briefly body during focusout; measure only afterwards.
		const syncLater = () => window.setTimeout(sync, 0);
		vv.addEventListener('resize', sync);
		document.addEventListener('focusin', sync);
		document.addEventListener('focusout', syncLater);
		return () => {
			vv.removeEventListener('resize', sync);
			document.removeEventListener('focusin', sync);
			document.removeEventListener('focusout', syncLater);
		};
	}, []);
	return open;
}
