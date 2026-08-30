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
		const getMenuItems = (): HTMLElement[] => {
			if (menuRef.current?.getAttribute('role') !== 'menu') return [];
			return Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
				(item) => !(item as HTMLButtonElement).disabled,
			);
		};
		const closeAndRestoreFocus = (): void => {
			onClose();
			requestAnimationFrame(() => triggerRef.current?.focus());
		};
		const handleKey = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeAndRestoreFocus();
				return;
			}
			const items = getMenuItems();
			if (items.length === 0) return;
			const currentIndex = items.indexOf(document.activeElement as HTMLElement);
			let nextIndex: number | null = null;
			if (event.key === 'ArrowDown')
				nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
			if (event.key === 'ArrowUp')
				nextIndex =
					currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
			if (event.key === 'Home') nextIndex = 0;
			if (event.key === 'End') nextIndex = items.length - 1;
			if (nextIndex !== null) {
				event.preventDefault();
				items[nextIndex]?.focus();
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
		const focusFirstItem = requestAnimationFrame(() => getMenuItems()[0]?.focus());
		return () => {
			cancelAnimationFrame(focusFirstItem);
			document.removeEventListener('keydown', handleKey);
			document.removeEventListener('mousedown', handlePointer);
		};
	}, [open, onClose, triggerRef, menuRef]);
}
