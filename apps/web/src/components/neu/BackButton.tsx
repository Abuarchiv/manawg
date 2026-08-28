'use client';

import { ArrowLeft } from 'lucide-react';

export function BackButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label="Zurück"
			className="inline-flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-md px-3 py-2 text-[13px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
		>
			<ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Zurück
		</button>
	);
}
