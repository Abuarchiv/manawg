'use client';

import { useTranslations } from 'next-intl';
import { InviteButton } from '@/components/wg/InviteButton';
import { useWg } from '@/components/wg/WgContextProvider';
import { cn } from '@/shared/lib/cn';

/**
 * One quiet line with the invite action while nobody else lives in the WG; gone once someone joins.
 * Left-aligned above a list by default, centered inside an empty state.
 */
export function SoloInviteRow({ centered = false }: { centered?: boolean }) {
	const t = useTranslations('home.soloInvite');
	const { wg, identity, members } = useWg();
	if (members.filter((member) => member.active).length >= 2) return null;
	return (
		<div
			className={cn(
				'flex flex-col text-meta text-muted-foreground',
				centered ? 'items-center text-center' : 'items-start',
			)}
		>
			<p>{t('text')}</p>
			<InviteButton
				code={wg.shareCode}
				memberId={identity.memberId}
				wgName={wg.name}
				className={cn(!centered && '-ml-2.5')}
			/>
		</div>
	);
}
