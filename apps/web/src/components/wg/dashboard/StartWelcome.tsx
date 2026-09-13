'use client';

import { Button, buttonVariants } from '@/components/ui/button';
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { useWg } from '@/components/wg/WgContextProvider';
import { CopyCodeButton } from '@/components/wg/dashboard/CopyCodeButton';
import { cn } from '@/shared/lib/cn';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function StartWelcome() {
	const { wg, identity, members } = useWg();
	// Stable WG/member IDs survive invitation-code changes and isolate preferences.
	const storageKey = `manawg:start-welcome-dismissed:${wg.id}:${identity.memberId}`;
	const [visibleFor, setVisibleFor] = useState<string | null>(null);
	useEffect(() => {
		try {
			setVisibleFor(localStorage.getItem(storageKey) === '1' ? null : storageKey);
		} catch {
			setVisibleFor(storageKey);
		}
	}, [storageKey]);

	function dismiss() {
		setVisibleFor(null);
		try {
			localStorage.setItem(storageKey, '1');
		} catch {
			// With blocked storage, dismissal still lasts for this mounted view.
		}
	}

	if (visibleFor !== storageKey) return null;
	const baseHref = `/wg/${encodeURIComponent(wg.shareCode)}`;
	const hasRoommates = members.filter((member) => member.active).length >= 2;
	const primaryAction = hasRoommates
		? { href: `${baseHref}/einkauf`, label: 'Einkauf öffnen' }
		: { href: `${baseHref}/einstellungen#zugang`, label: 'Mitbewohner einladen' };
	return (
		<section aria-labelledby="new-wg-heading">
			<Card size="sm">
				<CardHeader>
					<CardTitle>
						<h2 id="new-wg-heading">Eure WG ist bereit</h2>
					</CardTitle>
					<CardDescription>
						{!hasRoommates
							? 'Lade deine Mitbewohner ein und startet gemeinsam.'
							: 'Startet mit eurem ersten Eintrag.'}
					</CardDescription>
					<CardAction>
						<Button
							variant="ghost"
							size="icon"
							className="size-11"
							onClick={dismiss}
							aria-label="Einstiegshinweis dauerhaft ausblenden"
						>
							<X aria-hidden />
						</Button>
					</CardAction>
				</CardHeader>
				<CardContent className="flex flex-col gap-1">
					<Link href={primaryAction.href} className={cn(buttonVariants(), 'min-h-11')}>
						{primaryAction.label}
					</Link>
					<CopyCodeButton code={wg.shareCode} wgName={wg.name} joiningEnabled={wg.joiningEnabled} />
					{!wg.joiningEnabled && (
						<Link
							href={`${baseHref}/einstellungen#zugang`}
							className={cn(buttonVariants({ variant: 'link' }), 'min-h-11')}
						>
							Einladungen verwalten
						</Link>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
