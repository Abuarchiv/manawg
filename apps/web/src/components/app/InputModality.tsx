'use client';

import { useEffect } from 'react';

/** Marks keyboard use on the root element so focus rings show on touch devices with a keyboard. */
export function InputModality() {
	useEffect(() => {
		const root = document.documentElement;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Tab') root.dataset.input = 'keyboard';
		};
		const onPointer = () => {
			delete root.dataset.input;
		};
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('pointerdown', onPointer, true);
		return () => {
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('pointerdown', onPointer, true);
		};
	}, []);
	return null;
}
