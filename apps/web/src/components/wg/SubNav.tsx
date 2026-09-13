'use client';

import { getWgSection } from '@/components/app/navigation';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SubNavItem {
	href: string;
	label: string;
	icon: LucideIcon;
	/** Optional Zähler, z. B. Anzahl offener Mahnungen. 0 wird nicht gerendert. */
	count?: number;
}

interface SubNavProps {
	/** Beschreibt der Vorlesesoftware, wozu die Unterbereiche gehören. */
	label: string;
	items: SubNavItem[];
	/** Shell fallback disappears when a page supplies its own local navigation. */
	fallback?: boolean;
}

/**
 * Unterbereiche einer Modulseite (Ausgaben → Fixkosten/Mahnungen,
 * Einkauf → Vorräte). Bewusst als Navigation und nicht als Button-Reihe
 * gestaltet: es sind Orte, keine Aktionen — die Primäraktion der Seite
 * soll die einzige gefüllte Schaltfläche bleiben.
 */
export function SubNav({ label, items, fallback = false }: SubNavProps) {
	const pathname = usePathname()?.replace(/\/+$/, '') ?? '';
	const section = getWgSection(pathname);
	const canonicalItems =
		section?.pages.map((page) => ({
			href: `${section.baseHref}/${page.slug}`,
			label: page.label,
			icon: page.icon,
		})) ?? [];
	const links: SubNavItem[] = canonicalItems.map((item) => ({
		...item,
		...items.find((provided) => provided.href === item.href),
	}));
	links.push(
		...items.filter((item) => !canonicalItems.some((canonical) => canonical.href === item.href)),
	);
	const visibleLinks = links.filter((item) => {
		const target = new URL(item.href, 'https://manawg.invalid').pathname.replace(/\/+$/, '');
		return pathname !== target;
	});
	if (visibleLinks.length === 0) return null;

	return (
		<nav
			aria-label={label}
			data-wg-local-nav={fallback ? undefined : ''}
			className={cn('min-w-0', fallback && 'group-has-[[data-wg-local-nav]]/wg-shell:hidden')}
		>
			<ul className="flex flex-wrap gap-1">
				{visibleLinks.map(({ href, label: itemLabel, icon: Icon, count }) => {
					const target = new URL(href, 'https://manawg.invalid').pathname.replace(/\/+$/, '');
					const current = pathname === target;
					const active = current || pathname.startsWith(`${target}/`);
					return (
						<li key={href}>
							<Link
								href={href}
								aria-current={active ? (current ? 'page' : 'location') : undefined}
								className={cn(
									buttonVariants({ variant: active ? 'secondary' : 'ghost' }),
									'min-h-11',
								)}
							>
								<Icon data-icon="inline-start" aria-hidden />
								{itemLabel}
								{typeof count === 'number' && count > 0 && (
									<Badge variant="secondary" className="ml-0.5 tabular-nums">
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
