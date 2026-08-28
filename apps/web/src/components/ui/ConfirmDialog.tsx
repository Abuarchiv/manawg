'use client';

import { useModalDialog } from '@/core/hooks/useModalDialog';
import { cn } from '@/core/utils/utils';
import type { LucideIcon } from 'lucide-react';
import { useId, useRef } from 'react';

type ConfirmDialogVariant = 'default' | 'danger';

interface ConfirmDialogProps {
	open: boolean;
	onClose: () => void;
	onConfirm: () => void;
	title: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: ConfirmDialogVariant;
	icon?: LucideIcon;
}

const ACTION_BUTTON_CLASS: Record<ConfirmDialogVariant, string> = {
	default: 'btn-app-primary',
	danger:
		'rounded-md bg-[var(--danger)] text-[var(--danger-fg)] transition hover:opacity-90 active:scale-[0.98] border border-[var(--danger)]',
};

const ICON_COLOR_CLASS: Record<ConfirmDialogVariant, string> = {
	default: 'text-[var(--accent)]',
	danger: 'text-[var(--danger)]',
};

export function ConfirmDialog({
	open,
	onClose,
	onConfirm,
	title,
	description,
	confirmLabel = 'Bestätigen',
	cancelLabel = 'Abbrechen',
	variant = 'default',
	icon: Icon,
}: ConfirmDialogProps) {
	const cancelBtnRef = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	const descId = useId();

	const dialogRef = useModalDialog({
		open: open,
		onClose,
		initialFocusRef: cancelBtnRef,
	});

	if (!open) return null;

	const handleConfirm = () => {
		onConfirm();
		onClose();
	};

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is a mouse-only convenience; keyboard users dismiss via the native <dialog> cancel/Escape event wired in the effect above.
		<dialog
			ref={dialogRef}
			className="fixed inset-0 z-50 m-0 flex max-h-none max-w-none items-end justify-center border-0 bg-black/40 p-0 backdrop-blur-sm sm:items-center"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={descId}
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			{/* Panel — mobile: bottom sheet, desktop: centered card */}
			<div
				className={cn(
					'relative w-full glass gradient-border outline-none',
					// Mobile: bottom sheet
					'rounded-t-2xl max-h-[50vh] overflow-y-auto',
					// Desktop: centered card
					'sm:rounded-2xl sm:max-w-md sm:max-h-none sm:overflow-visible',
				)}
			>
				{/* Header */}
				<div className="flex items-start gap-3 px-5 pt-6 pb-3">
					{Icon && (
						<Icon
							className={cn('w-5 h-5 shrink-0 mt-0.5', ICON_COLOR_CLASS[variant])}
							aria-hidden="true"
						/>
					)}
					<h2 id={titleId} className="text-lg font-semibold text-[var(--text-1)]">
						{title}
					</h2>
				</div>

				{/* Body */}
				<p id={descId} className="px-5 pb-6 text-sm text-[var(--text-2)] leading-relaxed">
					{description}
				</p>

				{/* Actions — mobile: stacked (cancel first), desktop: row right-aligned */}
				<div className="flex flex-col gap-2 px-5 pb-6 sm:flex-row sm:justify-end sm:pb-5">
					<button
						ref={cancelBtnRef}
						type="button"
						onClick={onClose}
						className="w-full sm:w-auto min-h-11 btn-modern-ghost px-4 py-3 sm:py-2.5 text-sm font-semibold"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onClick={handleConfirm}
						className={cn(
							'w-full sm:w-auto min-h-11 px-4 py-3 sm:py-2.5 text-sm font-semibold transition-colors',
							ACTION_BUTTON_CLASS[variant],
						)}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</dialog>
	);
}
