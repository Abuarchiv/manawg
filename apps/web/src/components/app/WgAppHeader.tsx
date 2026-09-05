'use client';

import { buttonVariants } from '@/components/ui/button';
import { SubNav } from '@/components/wg/SubNav';
import { useWg } from '@/components/wg/WgContextProvider';
import { cn } from '@/shared/lib/cn';
import { UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getWgSection } from './navigation';

export function WgAppHeader() {
	const { wg } = useWg();
	const pathname = usePathname() ?? '';
	const baseHref = `/wg/${encodeURIComponent(wg.shareCode)}`;
	const section = getWgSection(pathname);

	return (
		<header data-app-chrome className="flex flex-col gap-2 px-4 pt-3">
			<div className="flex min-w-0 items-center gap-1">
				<Link
					href={baseHref}
					className={cn(
						buttonVariants({ variant: 'ghost' }),
						'h-auto min-h-11 min-w-0 flex-1 justify-start px-0',
					)}
				>
					<span className="flex min-w-0 flex-col items-start gap-0.5">
						<span className="text-xs text-muted-foreground">ManaWG</span>
						<span className="w-full truncate" title={wg.name}>
							{wg.name}
						</span>
					</span>
				</Link>
				<Link
					href={`${baseHref}/einstellungen`}
					aria-label="Konto und WG-Einstellungen öffnen"
					className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-11')}
				>
					<UserRound aria-hidden />
				</Link>
			</div>
			{section && <SubNav label={`${section.label} – Bereiche`} items={[]} fallback />}
		</header>
	);
}
