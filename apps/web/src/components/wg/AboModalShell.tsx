'use client';

import { ICON_BUTTON } from '@/components/ui/styles';
import { useFocusTrap } from '@/shared/lib/hooks/useFocusTrap';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface AboModalShellProps {
	title: string;
	onClose: () => void;
	children: ReactNode;
}

export function AboModalShell({ title, onClose, children }: AboModalShellProps) {
	const trapRef = useFocusTrap<HTMLDivElement>(true);

	useEffect(() => {
		const handleKey = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handleKey);
		return () => document.removeEventListener('keydown', handleKey);
	}, [onClose]);

	return (
		<div
			ref={trapRef}
			// biome-ignore lint/a11y/useSemanticElements: native <dialog> UA display:none kills CSS exit animations on iOS Safari; use div + role (see native-dialog-css-transition-kill skill).
			role="dialog"
			aria-modal="true"
			aria-labelledby="abo-modal-title"
			className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
		>
			<div
				className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--bg-base)] p-5 shadow-xl sm:rounded-2xl"
				style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
			>
				<span className="sheet-handle" aria-hidden />
				<div className="mb-4 flex items-center justify-between gap-3">
					<h2 id="abo-modal-title" className="text-base font-semibold text-[var(--text-1)]">
						{title}
					</h2>
					<button type="button" onClick={onClose} aria-label="Schließen" className={ICON_BUTTON}>
						<X className="h-4 w-4" aria-hidden />
					</button>
				</div>
				{children}
			</div>
		</div>
	);
}
