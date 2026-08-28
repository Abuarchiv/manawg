'use client';

import { type RefObject, useEffect } from 'react';

interface UseDismissableMenuOptions {
	open: boolean;
	onClose: () => void;
	triggerRef: RefObject<HTMLElement | null>;
	menuRef: RefObject<HTMLElement | null>;
}

/**
 * Closes an open menu/popover on Escape (refocusing the trigger) or on a
 * pointerdown outside both the trigger and the menu. Extracted from three
 * independently hand-rolled copies (ReactionPicker, MessageBubble,
 * AnnouncementCard) that had all converged on the same behavior.
 */
export function useDismissableMenu({
	open,
	onClose,
	triggerRef,
	menuRef,
}: UseDismissableMenuOptions): void {
	useEffect(() => {
		if (!open) return;
		const closeAndRestoreFocus = (): void => {
			onClose();
			requestAnimationFrame(() => triggerRef.current?.focus());
		};
		const handleKey = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeAndRestoreFocus();
			}
		};
		const handlePointer = (event: MouseEvent): void => {
			const target = event.target as Node | null;
			if (!target) return;
			if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
			onClose();
		};
		document.addEventListener('keydown', handleKey);
		document.addEventListener('mousedown', handlePointer);
		return () => {
			document.removeEventListener('keydown', handleKey);
			document.removeEventListener('mousedown', handlePointer);
		};
	}, [open, onClose, triggerRef, menuRef]);
}
