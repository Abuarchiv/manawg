import type { ReactNode } from 'react';

interface SectionProps {
	id?: string;
	title: string;
	hint?: string;
	children: ReactNode;
}

export function Section({ id, title, hint, children }: SectionProps) {
	return (
		<section id={id} className="scroll-mt-6">
			<div className="mb-2 px-1">
				<h2 className="text-sm font-semibold text-[var(--text-1)]">{title}</h2>
				{hint && <p className="mt-0.5 text-[12px] text-[var(--text-3)]">{hint}</p>}
			</div>
			<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)]">
				{children}
			</div>
		</section>
	);
}
