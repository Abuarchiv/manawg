import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface ModuleCardProps {
	href: string;
	Icon: LucideIcon;
	title: string;
	badge?: ReactNode;
	primary: ReactNode;
	secondary?: ReactNode;
}

export function ModuleCard({ href, Icon, title, badge, primary, secondary }: ModuleCardProps) {
	return (
		<Link
			href={href}
			className="group module-card flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-base)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[transform,box-shadow,border-color,background-color] duration-150 hover:-translate-y-px hover:border-[var(--border-strong)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
		>
			<div className="flex items-center justify-between">
				<div className="flex min-w-0 items-center gap-2">
					<Icon className="h-4 w-4 shrink-0 text-[var(--text-3)]" strokeWidth={1.75} aria-hidden />
					<span className="truncate text-[13px] font-medium text-[var(--text-2)]">{title}</span>
				</div>
				{badge && <div className="ml-1.5 shrink-0">{badge}</div>}
			</div>

			<div className="mt-3 flex-1 text-2xl font-semibold tabular-nums tracking-tight text-[var(--text-1)]">
				{primary}
			</div>

			<div className="mt-3 line-clamp-2 min-h-[2.5em] text-[12px] leading-snug text-[var(--text-3)]">
				{secondary ?? ''}
			</div>
		</Link>
	);
}
