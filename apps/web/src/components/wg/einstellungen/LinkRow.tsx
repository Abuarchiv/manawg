import Link from 'next/link';

export function LinkRow({ href, label }: { href: string; label: string }) {
	return (
		<li>
			<Link
				href={href}
				className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-3 text-[14px] text-[var(--text-1)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
			>
				<span>{label}</span>
				<span aria-hidden className="text-[var(--text-3)]">
					→
				</span>
			</Link>
		</li>
	);
}
