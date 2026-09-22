'use client';

import { getWgSection } from '@/components/app/navigation';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/shared/lib/cn';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SubNavItem {
	href: string;
	label: string;
	icon: LucideIcon;
	/** Optional Zähler, z. B. Anzahl offener Einträge. 0 wird nicht gerendert. */
	count?: number;
}

interface SubNavProps {
	/** Beschreibt der Vorlesesoftware, wozu die Unterbereiche gehören. Standard: Bereichsname. */
	label?: string;
	/** Nur außerhalb von /wg nötig (Entdecken); in der WG kommen die Ziele aus WG_SECTIONS. */
	items?: SubNavItem[];
	className?: string;
}

/**
 * Segment-Leiste eines Hauptbereichs (Haushalt: Einkauf · Vorräte · Putzen ·
 * Termine). Zeigt wie ein natives Segmented Control immer alle Geschwister und
 * markiert das aktuelle, damit man jederzeit sieht, wo man ist.
 */
export function SubNav({ label, items = [], className }: SubNavProps) {
	const pathname = usePathname()?.replace(/\/+$/, '') ?? '';
	const section = getWgSection(pathname);
	const links: SubNavItem[] = section
		? section.pages.map((page) => ({
				href: `${section.baseHref}/${page.slug}`,
				label: page.label,
				icon: page.icon,
			}))
		: items;
	if (links.length < 2) return null;

	return (
		<nav
			aria-label={label ?? section?.label ?? 'Unterbereiche'}
			className={cn('min-w-0', className)}
		>
			<ul className="grid auto-cols-[minmax(max-content,1fr)] grid-flow-col gap-1 overflow-x-auto rounded-xl bg-muted p-1 [scrollbar-width:none]">
				{links.map(({ href, label: itemLabel, icon: Icon, count }) => {
					const target = new URL(href, 'https://manawg.invalid').pathname.replace(/\/+$/, '');
					const current = pathname === target;
					const active = current || pathname.startsWith(`${target}/`);
					return (
						<li key={href} className="min-w-0">
							<Link
								href={href}
								aria-current={active ? (current ? 'page' : 'location') : undefined}
								className={cn(
									'flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium max-[419px]:px-1 max-[419px]:text-[13px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
									active
										? 'bg-background text-foreground ring-1 ring-border'
										: 'text-foreground/75 hover:text-foreground',
								)}
							>
								<Icon aria-hidden className="size-4 shrink-0 max-[419px]:hidden" />
								<span className="truncate">{itemLabel}</span>
								{typeof count === 'number' && count > 0 && (
									<Badge variant="secondary" className="tabular-nums">
										{count}
									</Badge>
								)}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
