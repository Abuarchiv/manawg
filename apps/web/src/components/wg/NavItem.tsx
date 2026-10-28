'use client';

import { Home, ListChecks, type LucideIcon, Megaphone, Receipt } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { navText } from '@/components/app/nav-text';
import { useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';
import { haptic } from '@/shared/lib/haptics';

type NavIconKey = 'home' | 'household' | 'finances' | 'community';

const ICONS: Record<NavIconKey, LucideIcon> = {
	home: Home,
	household: ListChecks,
	finances: Receipt,
	community: Megaphone,
};

interface NavItemProps {
	href: string;
	/** A `shell.nav.*` catalog key, or text that is already rendered. */
	label: string;
	iconKey: NavIconKey;
	/**
	 * Additional hrefs that mark this item active (parent grouping). Compared
	 * by exact path or `<prefix>/…` so `/wg/ABC/supplies` keeps Haushalt
	 * active while all deep links keep resolving.
	 */
	activePrefixes?: string[];
	/** Sub-pages of the section: the tab opens the last visited one (remembered per session). */
	slugs?: string[];
}

function readLastSlug(key: string, slugs: string[]): string | null {
	try {
		const stored = sessionStorage.getItem(key);
		return stored && slugs.includes(stored) ? stored : null;
	} catch {
		return null;
	}
}

export function NavItem({ href, label, iconKey, activePrefixes, slugs }: NavItemProps) {
	const message = useMessage();
	const labelText = navText(label, message);
	const pathname = usePathname();
	// SSR and the first render use the default href (stable hydration); afterwards it switches
	// to the remembered sub-page.
	const [rememberedHref, setRememberedHref] = useState<string | null>(null);
	const base = href.slice(0, href.lastIndexOf('/'));
	const storageKey = `wg-tab:${base}:${iconKey}`;
	const slugsKey = slugs?.join(',') ?? '';
	useEffect(() => {
		if (!slugsKey) return;
		const list = slugsKey.split(',');
		const current = pathname?.replace(/\/+$/, '') ?? '';
		const match = current.startsWith(`${base}/`) ? current.slice(base.length + 1) : '';
		if (list.includes(match)) {
			try {
				sessionStorage.setItem(storageKey, match);
			} catch {
				// Private mode: the default tab stays.
			}
		}
		const last = readLastSlug(storageKey, list);
		setRememberedHref(last ? `${base}/${last}` : null);
	}, [pathname, slugsKey, base, storageKey]);
	const linkHref = rememberedHref ?? href;
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
				href={linkHref}
				// Full prefetch keeps the page payload in the router cache, so the first switch
				// does not suspend into loading.tsx (React holds a shown fallback for ~300 ms).
				prefetch
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
				<span className="max-w-full whitespace-nowrap text-center text-[length:clamp(12px,0.75rem,16px)] font-medium leading-4">
					{labelText}
				</span>
			</Link>
		</li>
	);
}
