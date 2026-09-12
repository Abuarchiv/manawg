import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

export function LinkRow({ href, label }: { href: string; label: string }) {
	return (
		<li>
			<Link
				href={href}
				className="text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring flex min-h-[44px] items-center justify-between gap-3 px-4 py-3 text-sm transition-colors"
			>
				<span>{label}</span>
				<ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
			</Link>
		</li>
	);
}
