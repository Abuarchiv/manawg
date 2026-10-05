'use client';

import { cn } from '@/shared/lib/cn';
import { haptic } from '@/shared/lib/haptics';
import { Home, ListChecks, type LucideIcon, Megaphone, Receipt } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type NavIconKey = 'home' | 'haushalt' | 'finanzen' | 'austausch';

const ICONS: Record<NavIconKey, LucideIcon> = {
	home: Home,
	haushalt: ListChecks,
	finanzen: Receipt,
	austausch: Megaphone,
};

interface NavItemProps {
	href: string;
	label: string;
	iconKey: NavIconKey;
	/**
	 * Additional hrefs that mark this item active (parent grouping). Compared
	 * by exact path or `<prefix>/…` so `/wg/ABC/vorraete` keeps Haushalt
	 * active while all deep links keep resolving.
	 */
	activePrefixes?: string[];
}

export function NavItem({ href, label, iconKey, activePrefixes }: NavItemProps) {
	const pathname = usePathname();
	const normalizedPath = pathname?.replace(/\/+$/, '') ?? '';
	const normalizedHref = new URL(href, 'https://manawg.invalid').pathname.replace(/\/+$/, '');
	const normalizedPrefixes = (activePrefixes ?? []).map((prefix) =>
		new URL(prefix, 'https://manawg.invalid').pathname.replace(/\/+$/, ''),
	);
	const prefixActive = normalizedPrefixes.some(
		(prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
	);
	const isCurrentPage = normalizedPath === normalizedHref;
	const isActive = isCurrentPage || prefixActive;
	const Icon = ICONS[iconKey];

	return (
		<li>
			<Link
				href={href}
				aria-current={isActive ? (isCurrentPage ? 'page' : 'location') : undefined}
				data-bottom-nav-item
				onClick={() => {
					if (!isActive) haptic('light');
				}}
				className={cn(
					'flex min-h-11 w-full flex-col items-center justify-center gap-0 rounded-[14px] py-0.5 text-foreground/70 outline-none transition-colors duration-[120ms] select-none focus-visible:ring-2 focus-visible:ring-ring',
					isActive ? 'glass-pill text-foreground' : 'active:bg-foreground/5',
				)}
			>
				<Icon aria-hidden className="size-[18px]" strokeWidth={1.5} />
				<span className="max-w-full whitespace-nowrap text-center text-[11px] font-medium leading-4">
					{label}
				</span>
			</Link>
		</li>
	);
}
