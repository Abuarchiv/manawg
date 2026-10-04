'use client';

import { buttonVariants } from '@/components/ui/button';
import { ChatTopBarLink } from '@/components/wg/ChatTopBarLink';
import { useWg } from '@/components/wg/WgContextProvider';
import { LogoMark } from '@/shared/components/ui/LogoMark';
import { cn } from '@/shared/lib/cn';
import { UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef } from 'react';

export function WgAppHeader() {
	const { wg } = useWg();
	const pathname = usePathname() ?? '';
	const baseHref = `/wg/${encodeURIComponent(wg.shareCode)}`;
	const isStart = /^\/wg\/[^/]+\/?$/.test(pathname);
	const ref = useRef<HTMLElement>(null);
	// Der Chat rechnet seine Rahmenhöhe aus dem Viewport und braucht die Kopfhöhe.
	useLayoutEffect(() => {
		const header = ref.current;
		if (!header) return;
		const root = header.ownerDocument.documentElement;
		const measure = () =>
			root.style.setProperty('--app-header-height', `${header.getBoundingClientRect().height}px`);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(header);
		return () => {
			observer.disconnect();
			root.style.removeProperty('--app-header-height');
		};
	}, []);

	// Ein Kopf für alle Seiten, wie im öffentlichen Shell: Unterseiten zeigen
	// WG-Name und Aktionen in einer Zeile; das <h1> gehört
	// nur zur Startseite, Unterseiten haben ihren eigenen Seitentitel.
	return (
		<header
			ref={ref}
			data-home-header={isStart ? '' : undefined}
			data-app-chrome
			className="mx-auto flex w-full max-w-[var(--app-frame-width)] flex-col gap-2 px-4 pt-2 pb-0"
		>
			<div className="flex min-h-10 min-w-0 items-center gap-2">
				<LogoMark
					size={24}
					tile={false}
					markFill="currentColor"
					className="size-6 shrink-0 text-foreground"
				/>
				{isStart ? (
					<h1
						aria-label={`${wg.name} – Start`}
						title={wg.name}
						className="min-w-0 flex-1 truncate font-heading text-xl font-semibold tracking-[-0.03em]"
					>
						{wg.name}
					</h1>
				) : (
					<p
						title={wg.name}
						className="min-w-0 flex-1 truncate font-heading text-xl font-semibold tracking-[-0.03em]"
					>
						{wg.name}
					</p>
				)}
				<div className="flex shrink-0 items-center gap-2">
					<ChatTopBarLink
						href={`${baseHref}/chat`}
						className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'relative shrink-0')}
					/>
					<Link
						href={`${baseHref}/einstellungen`}
						aria-label="Konto und WG-Einstellungen öffnen"
						className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'shrink-0')}
					>
						<UserRound aria-hidden />
					</Link>
				</div>
			</div>
		</header>
	);
}
