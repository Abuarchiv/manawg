'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
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
import { cn } from '@/shared/lib/cn';
import { InviteButton } from './InviteButton';

export function StartWelcome({ dismissedFallback }: { dismissedFallback?: React.ReactNode }) {
	const { wg, identity, members } = useWg();
	// Stable WG/member IDs isolate the preference per WG and member.
	const storageKey = `manawg:start-welcome-dismissed:${wg.id}:${identity.memberId}`;
	// null until localStorage was read, so the fallback does not flash on load.
	const [status, setStatus] = useState<{ key: string; dismissed: boolean } | null>(null);
	useEffect(() => {
		try {
			setStatus({ key: storageKey, dismissed: localStorage.getItem(storageKey) === '1' });
		} catch {
			setStatus({ key: storageKey, dismissed: false });
		}
	}, [storageKey]);

	function dismiss() {
		// The button disappears shortly: move focus to the next heading first.
		document.getElementById('week-heading')?.focus({ preventScroll: true });
		setStatus({ key: storageKey, dismissed: true });
		try {
			localStorage.setItem(storageKey, '1');
		} catch {
			// With blocked storage, dismissal still lasts for this mounted view.
		}
	}

	if (status?.key !== storageKey) return null;
	if (status.dismissed) return <>{dismissedFallback}</>;
	const baseHref = `/wg/${encodeURIComponent(wg.shareCode)}`;
	const hasRoommates = members.filter((member) => member.active).length >= 2;
	return (
		<section aria-labelledby="new-wg-heading">
			<Card size="sm">
				<CardHeader>
					<CardTitle>
						<h2 id="new-wg-heading">Eure WG ist bereit</h2>
					</CardTitle>
					<CardDescription>
						{!hasRoommates
							? 'Lade deine Mitbewohner ein und starte gemeinsam mit ihnen.'
							: 'Startet mit eurem ersten Eintrag.'}
					</CardDescription>
					<CardAction>
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							onClick={dismiss}
							aria-label="Einstiegshinweis dauerhaft ausblenden"
						>
							<X aria-hidden />
						</Button>
					</CardAction>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					{hasRoommates && (
						<Link href={`${baseHref}/einkauf`} className={cn(buttonVariants(), 'w-full')}>
							Einkauf öffnen
						</Link>
					)}
					<InviteButton
						code={wg.shareCode}
						memberId={identity.memberId}
						wgName={wg.name}
						className="w-full"
						variant={hasRoommates ? 'ghost' : 'default'}
					/>
				</CardContent>
			</Card>
		</section>
	);
}
