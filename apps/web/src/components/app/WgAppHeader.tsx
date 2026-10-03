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
	const { wg, identity } = useWg();
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
	// WG-Name und Aktionen in einer Zeile; die Begrüßung und das <h1> gehören
	// nur zur Startseite, Unterseiten haben ihren eigenen Seitentitel.
	return (
		<header
			ref={ref}
			data-home-header={isStart ? '' : undefined}
			data-app-chrome
			className={cn(
				'mx-auto flex w-full max-w-[var(--app-frame-width)] flex-col gap-2 px-4',
				isStart ? 'pt-3 pb-2' : 'pt-2 pb-0',
			)}
		>
			<div className="flex min-w-0 flex-wrap items-center gap-1">
				<LogoMark
					size={24}
					tile={false}
					markFill="currentColor"
					className="size-6 shrink-0 text-foreground"
				/>
				<div className="min-w-0 flex-[1_1_128px] py-1">
					{isStart ? (
						<h1
							aria-label={`${wg.name} – Start`}
							title={wg.name}
							className="truncate text-lg font-semibold tracking-tight"
						>
							{wg.name}
						</h1>
					) : (
						<p title={wg.name} className="truncate text-lg font-semibold tracking-tight">
							{wg.name}
						</p>
					)}
					{isStart && (
						<p className="truncate text-sm text-muted-foreground">Hallo, {identity.name}.</p>
					)}
				</div>
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
