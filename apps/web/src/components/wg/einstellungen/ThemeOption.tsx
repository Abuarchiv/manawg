'use client';

import type { ReactNode } from 'react';

interface ThemeOptionProps {
	label: string;
	icon: ReactNode;
	active: boolean;
	onClick: () => void;
}

export function ThemeOption({ label, icon, active, onClick }: ThemeOptionProps) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
				active
					? 'border-[var(--text-1)] bg-[var(--text-1)] text-[var(--bg-base)]'
					: 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
			}`}
		>
			{icon}
			{label}
		</button>
	);
}
