'use client';

import { haptic } from '@/shared/lib/haptics';
import {
	Bell,
	CalendarDays,
	Home,
	ListChecks,
	type LucideIcon,
	Megaphone,
	MessageCircle,
	Package,
	Receipt,
	RefreshCw,
	Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type NavIconKey =
	| 'home'
	| 'ausgaben'
	| 'einkauf'
	| 'pinnwand'
	| 'putzen'
	| 'kalender'
	| 'vorraete'
	| 'abos'
	| 'mahnungen'
	| 'chat';

const ICONS: Record<NavIconKey, LucideIcon> = {
	home: Home,
	ausgaben: Receipt,
	einkauf: ListChecks,
	pinnwand: Megaphone,
	putzen: Sparkles,
	kalender: CalendarDays,
	vorraete: Package,
	abos: RefreshCw,
	mahnungen: Bell,
	chat: MessageCircle,
};

interface NavItemProps {
	href: string;
	label: string;
	iconKey: NavIconKey;
	badgeCount?: number;
}

const BADGE_MAX_DISPLAY = 99;

export function NavItem({ href, label, iconKey, badgeCount }: NavItemProps) {
	const pathname = usePathname();
	const normalizedPath = pathname?.replace(/\/+$/, '') ?? '';
	const normalizedHref = href.replace(/\/+$/, '');
	const isActive = normalizedPath === normalizedHref;
	const Icon = ICONS[iconKey];
	const normalizedBadge = typeof badgeCount === 'number' && badgeCount > 0 ? badgeCount : null;
	const showBadge = normalizedBadge !== null;
	const badgeText =
		normalizedBadge !== null && normalizedBadge > BADGE_MAX_DISPLAY
			? `${BADGE_MAX_DISPLAY}+`
			: normalizedBadge;

	return (
		<li>
			<Link
				href={href}
				aria-current={isActive ? 'page' : undefined}
				data-bottom-nav-item
				onClick={() => {
					if (!isActive) haptic('light');
				}}
				className={`flex w-full min-h-[48px] flex-col items-center justify-center gap-1 rounded-md px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
					isActive ? 'text-[var(--text-1)]' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
				}`}
			>
				<span className="relative">
					<Icon className="h-5 w-5" strokeWidth={isActive ? 2.25 : 1.75} aria-hidden />
					{showBadge && (
						<span
							aria-label={`${badgeCount} ungelesen`}
							aria-live="polite"
							aria-atomic="true"
							className="absolute -right-2 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[9px] font-bold leading-none text-[var(--danger-fg)]"
						>
							{badgeText}
						</span>
					)}
				</span>
				<span className="text-[11px] font-medium leading-none tracking-tight">{label}</span>
			</Link>
		</li>
	);
}
