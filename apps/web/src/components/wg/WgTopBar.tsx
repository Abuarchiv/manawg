'use client';

import { ChatTopBarLink } from '@/components/wg/ChatTopBarLink';
import { ThemeToggle } from '@manawg/shared/components/theme/ThemeToggle';
import { LogoMark } from '@manawg/shared/components/ui/LogoMark';
import { Clock3, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface WgTopBarProps {
	code: string;
}

export function WgTopBar({ code }: WgTopBarProps) {
	const pathname = usePathname();
	const wgBaseHref = `/wg/${encodeURIComponent(code)}`;
	if (pathname === wgBaseHref) return null;

	return (
		<nav
			aria-label="WG Schnellzugriff"
			data-app-chrome
			className="mx-auto flex max-w-2xl items-center gap-2 px-4 pt-3 sm:px-6"
		>
			<Link
				href={wgBaseHref}
				aria-label="Zum WG-Dashboard"
				className="mr-auto inline-flex h-11 items-center rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
			>
				<LogoMark size={28} radius={8} className="shrink-0 rounded-lg" />
			</Link>
			<ChatTopBarLink
				href={`${wgBaseHref}/chat`}
				className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] shadow-sm transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
			/>
			<Link
				href={`${wgBaseHref}/suche`}
				aria-label="WG durchsuchen"
				aria-current={pathname === `${wgBaseHref}/suche` ? 'page' : undefined}
				className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] shadow-sm transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
			>
				<Search className="h-4 w-4" aria-hidden />
			</Link>
			<Link
				href={`${wgBaseHref}/aktivitaet`}
				aria-label="Aktivitätschronik öffnen"
				aria-current={pathname === `${wgBaseHref}/aktivitaet` ? 'page' : undefined}
				className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] shadow-sm transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
			>
				<Clock3 className="h-4 w-4" aria-hidden />
			</Link>
			<ThemeToggle
				compact
				className="hidden h-11 w-11 shrink-0 rounded-xl shadow-sm sm:inline-flex"
			/>
		</nav>
	);
}
