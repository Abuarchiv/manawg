'use client';

import { Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useCurrentInviteShare } from '@/components/wg/use-current-invite-share';
import { useWg } from '@/components/wg/WgContextProvider';
import { cn } from '@/shared/lib/cn';

/**
 * One quiet line with the invite action while nobody else lives in the WG; gone once someone joins.
 * Left-aligned above a list by default, centered inside an empty state.
 */
export function SoloInviteRow({ centered = false }: { centered?: boolean }) {
	const { members } = useWg();
	if (members.filter((member) => member.active).length >= 2) return null;
	return <SoloInviteContent centered={centered} />;
}

function SoloInviteContent({ centered }: { centered?: boolean }) {
	const t = useTranslations('home.soloInvite');
	const invite = useTranslations('home.invite');
	const notice = useTranslations('home.inviteCard');
	const { state, shared, sharing, share, retry } = useCurrentInviteShare('row');
	return (
		<div
			className={cn(
				'flex flex-col text-meta text-muted-foreground',
				centered ? 'items-center text-center' : 'items-start',
			)}
		>
			<p>{t('text')}</p>
			<Button
				type="button"
				variant="ghost"
				className={cn('h-auto whitespace-normal', !centered && '-ml-2.5')}
				disabled={sharing || state.status === 'loading'}
				onClick={state.status === 'failed' ? retry : () => void share()}
			>
				<Share2 data-icon="inline-start" aria-hidden />
				{state.status === 'failed' ? notice('retry') : invite('invite')}
			</Button>
			{shared && <output aria-live="polite">{notice(shared)}</output>}
		</div>
	);
}
