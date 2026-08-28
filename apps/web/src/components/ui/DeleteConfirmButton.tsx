'use client';

import { useConfirmDelete } from '@/core/hooks/useConfirmDelete';
import { Loader2, Trash2 } from 'lucide-react';

interface Props {
	id: string;
	onConfirm: () => void | Promise<void>;
	pending: boolean;
	ariaLabel: string;
	ariaLabelConfirm: string;
	timeoutMs?: number;
}

export function DeleteConfirmButton({
	id,
	onConfirm,
	pending,
	ariaLabel,
	ariaLabelConfirm,
	timeoutMs,
}: Props): React.ReactElement {
	const { confirmId, request } = useConfirmDelete(timeoutMs);
	const isArmed = confirmId === id;

	function handleClick(): void {
		const shouldConfirm = request(id);
		if (shouldConfirm) {
			void onConfirm();
		}
	}

	if (isArmed) {
		return (
			<button
				type="button"
				onClick={handleClick}
				disabled={pending}
				aria-label={ariaLabelConfirm}
				className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md bg-[var(--danger)] px-3.5 text-[12px] font-medium text-[var(--danger-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:opacity-50"
			>
				{pending ? (
					<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
				) : (
					<Trash2 className="h-4 w-4" aria-hidden />
				)}
				OK
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={handleClick}
			disabled={pending}
			aria-label={ariaLabel}
			className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-3)] opacity-70 transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] focus-visible:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 group-hover:opacity-100 disabled:opacity-50 sm:opacity-60"
		>
			<Trash2 className="h-4 w-4" aria-hidden />
		</button>
	);
}
