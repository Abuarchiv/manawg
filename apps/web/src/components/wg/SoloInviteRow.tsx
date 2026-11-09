'use client';

import { useTranslations } from 'next-intl';
import { InviteButton } from '@/components/wg/InviteButton';
import { useWg } from '@/components/wg/WgContextProvider';
import { cn } from '@/shared/lib/cn';

/** One quiet line with the invite action while nobody else lives in the WG; gone once someone joins. */
export function SoloInviteRow({ className }: { className?: string }) {
	const t = useTranslations('home.soloInvite');
	const { wg, identity, members } = useWg();
	if (members.filter((member) => member.active).length >= 2) return null;
	return (
		<div
			className={cn(
				'flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-meta text-muted-foreground',
				className,
			)}
		>
			<p>{t('text')}</p>
			<InviteButton code={wg.shareCode} memberId={identity.memberId} wgName={wg.name} />
		</div>
	);
}
