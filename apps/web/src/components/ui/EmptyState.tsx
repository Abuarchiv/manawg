import { Plus } from 'lucide-react';
import type React from 'react';

interface EmptyStateProps {
	icon: React.ReactNode;
	headline: string;
	sub: string;
	cta?: {
		label: string;
		onClick: () => void;
		icon?: React.ReactNode;
	};
}

/**
 * Empty state — mobile-first, centered, consistent across all sections.
 * py-12 on mobile, py-16 on sm+. Icon 48px chip. Responsive text.
 */
export function EmptyState({ icon, headline, sub, cta }: EmptyStateProps) {
	return (
		<div className="py-12 sm:py-16 flex flex-col items-center gap-3 text-center">
			<div className="w-12 h-12 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--text-3)]">
				{icon}
			</div>
			<div className="space-y-1 max-w-sm">
				<p className="text-lg sm:text-xl font-semibold text-[var(--text-1)] tracking-[-0.01em]">
					{headline}
				</p>
				<p className="text-sm sm:text-base text-[var(--text-2)] mb-4">{sub}</p>
			</div>
			{cta !== undefined && (
				<button
					type="button"
					onClick={cta.onClick}
					className="btn-app-primary mt-2 w-full sm:w-auto min-h-11 justify-center"
				>
					{cta.icon ?? <Plus className="w-4 h-4" aria-hidden="true" />}
					{cta.label}
				</button>
			)}
		</div>
	);
}
