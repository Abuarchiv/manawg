'use client';

import { useEffect, useState } from 'react';

/** Schwelle: so viel kleiner als das Fenster muss der sichtbare Bereich sein, damit wir von einer Bildschirmtastatur ausgehen. */
const KEYBOARD_MIN_HEIGHT = 100;

/** True, solange ein Eingabefeld Fokus hat und die Bildschirmtastatur den sichtbaren Bereich verkleinert. */
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
		// Beim Feldwechsel steht activeElement im focusout kurz auf body; erst danach messen.
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
