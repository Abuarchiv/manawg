'use client';

import { useDismissableMenu } from '@/core/hooks/useDismissableMenu';
import { haptic } from '@/shared/lib/haptics';
import { Smile } from 'lucide-react';
import { useRef, useState } from 'react';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '🔥', '😢', '👀'] as const;

interface ReactionPickerProps {
	onSelect: (emoji: string) => void;
	triggerLabel?: string;
}

export function ReactionPicker({ onSelect, triggerLabel }: ReactionPickerProps) {
	const [open, setOpen] = useState(false);
	const [custom, setCustom] = useState('');
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popupRef = useRef<HTMLDivElement>(null);

	function submitCustom(): void {
		const value = custom.trim();
		if (value.length === 0) return;
		onSelect(value);
		setCustom('');
		setOpen(false);
	}

	function handleOpen(): void {
		const next = !open;
		if (next) haptic('light');
		setOpen(next);
	}

	useDismissableMenu({
		open,
		onClose: () => setOpen(false),
		triggerRef,
		menuRef: popupRef,
	});

	return (
		<div className="relative">
			<button
				ref={triggerRef}
				type="button"
				onClick={handleOpen}
				aria-label={triggerLabel ?? 'Reaktion hinzufügen'}
				aria-haspopup="dialog"
				aria-expanded={open}
				className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
			>
				<Smile className="h-4 w-4" aria-hidden />
			</button>
			{open && (
				<div
					ref={popupRef}
					// biome-ignore lint/a11y/useSemanticElements: native <dialog> blocks page scroll and carries UA styling; intentional <div role="dialog"> popover pattern (see native-dialog-css-transition-kill skill).
					role="dialog"
					aria-label="Reaktion wählen"
					className="absolute bottom-10 right-0 left-auto z-20 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-base)]/95 p-1 shadow-lg backdrop-blur-sm max-sm:fixed max-sm:inset-x-3 max-sm:bottom-[calc(8rem+env(safe-area-inset-bottom,0px))] max-sm:w-auto"
				>
					<div className="grid grid-cols-4 gap-0.5 sm:flex sm:items-center">
						{QUICK_EMOJIS.map((emoji) => (
							<button
								key={emoji}
								type="button"
								aria-label={`Reaktion ${emoji}`}
								onClick={() => {
									onSelect(emoji);
									setOpen(false);
								}}
								className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-xl transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								{emoji}
							</button>
						))}
					</div>
					<div className="flex items-center gap-2 px-1 pb-1">
						<input
							value={custom}
							onChange={(e) => setCustom(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									submitCustom();
								}
							}}
							placeholder="Emoji eingeben"
							aria-label="Eigene Emoji-Reaktion"
							className="h-11 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-2 text-[13px] text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						/>
						<button
							type="button"
							onClick={submitCustom}
							disabled={custom.trim().length === 0}
							className="h-11 rounded-lg bg-[var(--text-1)] px-3 text-[12px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-40"
						>
							OK
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
