import Link from 'next/link';
import type { ReactNode } from 'react';

interface PanelProps {
	title: string;
	linkHref?: string;
	children: ReactNode;
}

export function Panel({ title, linkHref, children }: PanelProps) {
	return (
		<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-5">
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-sm font-semibold text-[var(--text-1)]">{title}</h2>
				{linkHref && (
					<Link
						href={linkHref}
						className="-mx-2 inline-flex min-h-11 items-center px-2 text-[12.5px] text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
					>
						Alle →
					</Link>
				)}
			</div>
			{children}
		</div>
	);
}
