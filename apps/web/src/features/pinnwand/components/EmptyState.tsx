import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
	icon: Icon,
	hint,
	children,
}: {
	icon: LucideIcon;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div className="rounded-lg border border-dashed border-[var(--border)] px-6 py-12 text-center">
			<Icon className="mx-auto mb-3 h-7 w-7 text-[var(--text-3)]" strokeWidth={1.5} aria-hidden />
			<p className="mx-auto max-w-[22ch] text-[13.5px] leading-relaxed text-[var(--text-2)]">
				{children}
			</p>
			{hint && <p className="mt-1 text-[12.5px] text-[var(--text-3)]">{hint}</p>}
		</div>
	);
}
