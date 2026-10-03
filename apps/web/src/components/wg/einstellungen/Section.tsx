import type { ReactNode } from 'react';

interface SectionProps {
	id?: string;
	title: string;
	hint?: string | undefined;
	children: ReactNode;
}

export function Section({ id, title, hint, children }: SectionProps) {
	return (
		<section id={id} aria-label={title} className="min-w-0 scroll-mt-24">
			<header className="mb-1.5">
				<h2 className="font-heading text-sm font-semibold">{title}</h2>
				{hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
			</header>
			<div className="overflow-hidden rounded-xl border border-border">{children}</div>
		</section>
	);
}
