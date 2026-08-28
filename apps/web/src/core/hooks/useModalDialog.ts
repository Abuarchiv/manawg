'use client';

import { type RefObject, useEffect, useRef } from 'react';

interface UseModalDialogOptions {
	/** Whether the dialog should currently be shown. */
	open: boolean;
	onClose: () => void;
	/** Focused once the dialog opens — by convention the cancel button. */
	initialFocusRef: RefObject<HTMLElement | null>;
}

/**
 * Drives a native `<dialog>` as a modal: opens it, routes the browser's own
 * cancel event (Escape, back gesture) through `onClose`, moves focus to the
 * safe action, and closes it again on unmount.
 *
 * ConfirmDialog and MemberDeactivateDialog each hand-rolled this, and the
 * second one's comment already said it was copied "so focus handling stays
 * consistent across the app" — which is an argument for having it in one
 * place rather than two.
 *
 * `onClose` is read through a ref on purpose. Callers pass inline closures
 * (`onClose={() => setX(null)}`), so depending on it directly would re-run the
 * effect — and re-steal focus — on every parent render while the dialog is
 * open.
 */
export function useModalDialog({
	open,
	onClose,
	initialFocusRef,
}: UseModalDialogOptions): RefObject<HTMLDialogElement | null> {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!open) return;
		const dialog = dialogRef.current;
		if (!dialog) return;

		if (!dialog.open) dialog.showModal();
		const handleCancel = (event: Event) => {
			event.preventDefault();
			onCloseRef.current();
		};
		dialog.addEventListener('cancel', handleCancel);
		requestAnimationFrame(() => initialFocusRef.current?.focus());

		return () => {
			dialog.removeEventListener('cancel', handleCancel);
			if (dialog.open) dialog.close();
		};
	}, [open, initialFocusRef]);

	return dialogRef;
}
