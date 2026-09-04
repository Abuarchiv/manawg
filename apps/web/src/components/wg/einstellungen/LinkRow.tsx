import Link from 'next/link';

export function LinkRow({
	href,
	label,
	external = false,
}: {
	href: string;
	label: string;
	external?: boolean;
}) {
	return (
		<li>
			<Link
				href={href}
				target={external ? '_blank' : undefined}
				rel={external ? 'noopener noreferrer' : undefined}
				aria-label={external ? `${label} (öffnet in neuem Tab)` : undefined}
				className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-3 text-[14px] text-[var(--text-1)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
			>
				<span>
					{label}
					{external && <span className="ml-1 text-[12px] text-[var(--text-3)]">(extern)</span>}
				</span>
				<span aria-hidden className="text-[var(--text-3)]">
					→
				</span>
			</Link>
		</li>
	);
}
