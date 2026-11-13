'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
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
import { InviteButton } from '@/components/wg/InviteButton';
import { useWg } from '@/components/wg/WgContextProvider';
import { cn } from '@/shared/lib/cn';
import { isWelcomeHidden, welcomeDismissalValue } from './welcome-dismissal';

export function StartWelcome({ dismissedFallback }: { dismissedFallback?: React.ReactNode }) {
	const t = useTranslations('home.welcome');
	const { wg, identity, members } = useWg();
	// Stable WG/member IDs isolate the preference per WG and member.
	const storageKey = `manawg:start-welcome-dismissed:${wg.id}:${identity.memberId}`;
	const roommates = members.filter((member) => member.active && member.id !== identity.memberId);
	const hasRoommates = roommates.length > 0;
	// null until localStorage was read, so the fallback does not flash on load.
	const [status, setStatus] = useState<{ key: string; stored: string | null } | null>(null);
	useEffect(() => {
		try {
			setStatus({ key: storageKey, stored: localStorage.getItem(storageKey) });
		} catch {
			setStatus({ key: storageKey, stored: null });
		}
	}, [storageKey]);

	function dismiss() {
		// The button disappears shortly: move focus to the next heading first.
		document.getElementById('week-heading')?.focus({ preventScroll: true });
		const stored = welcomeDismissalValue(Date.now(), !hasRoommates);
		setStatus({ key: storageKey, stored });
		try {
			localStorage.setItem(storageKey, stored);
		} catch {
			// With blocked storage, dismissal still lasts for this mounted view.
		}
	}

	if (status?.key !== storageKey) return null;
	if (isWelcomeHidden(status.stored, Date.now(), !hasRoommates)) return <>{dismissedFallback}</>;
	const baseHref = `/wg/${encodeURIComponent(wg.shareCode)}`;
	// The roster is ordered by joining date: the last other active member joined most recently.
	const newest = roommates.at(-1);
	return (
		<section aria-labelledby="new-wg-heading">
			<Card size="sm">
				<CardHeader>
					<CardTitle>
						<h2 id="new-wg-heading">{t('title')}</h2>
					</CardTitle>
					<CardDescription>
						{newest ? t('descriptionRoommateIn', { name: newest.name }) : t('descriptionAlone')}
					</CardDescription>
					<CardAction>
						{hasRoommates ? (
							<Button
								variant="ghost"
								size="icon"
								className="size-8"
								onClick={dismiss}
								aria-label={t('dismiss')}
							>
								<X aria-hidden />
							</Button>
						) : (
							// Alone, dismissing only snoozes the card: say so instead of showing a close icon.
							<Button variant="ghost" size="sm" onClick={dismiss}>
								{t('dismissSolo')}
							</Button>
						)}
					</CardAction>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					{hasRoommates ? (
						<>
							<Link href={`${baseHref}/expenses?new=1`} className={cn(buttonVariants(), 'w-full')}>
								{t('addExpense')}
							</Link>
							<Link
								href={`${baseHref}/shopping`}
								className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
							>
								{t('openShopping')}
							</Link>
							<InviteButton code={wg.shareCode} memberId={identity.memberId} wgName={wg.name} />
						</>
					) : (
						<InviteButton
							code={wg.shareCode}
							memberId={identity.memberId}
							wgName={wg.name}
							className="w-full"
							variant="default"
						/>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
