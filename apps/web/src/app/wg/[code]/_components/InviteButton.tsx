'use client';

import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { createInvite, inviteShareMessage, shareInvite } from '@/components/wg/invite-share';
import { useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';
import { AlertTriangle, Check, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

const RESET_MS = 1500;
const FAILED_RESET_MS = 4000;

interface InviteButtonProps {
	code: string;
	memberId: string;
	wgName: string;
	variant?: 'default' | 'ghost';
	className?: string;
}

type ShareState = 'idle' | 'shared' | 'copied' | 'failed';

/** Creates a fresh 7-day invitation link and hands it to the share sheet or the clipboard. */
export function InviteButton({
	code,
	memberId,
	wgName,
	variant = 'ghost',
	className,
}: InviteButtonProps) {
	const t = useTranslations('home.invite');
	const [state, setState] = useState<ShareState>('idle');
	const [sharing, setSharing] = useState(false);
	const timerRef = useRef<number | null>(null);
	const sharingRef = useRef(false);
	const toast = useToast();
	const render = useMessage();

	useEffect(() => {
		return () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		};
	}, []);

	function flash(next: ShareState): void {
		setState(next);
		if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(
			() => {
				setState('idle');
				timerRef.current = null;
			},
			next === 'failed' ? FAILED_RESET_MS : RESET_MS,
		);
	}

	async function onClick(): Promise<void> {
		if (sharingRef.current) return;
		sharingRef.current = true;
		setSharing(true);
		try {
			const created = await createInvite(code, memberId);
			if (!created.ok) {
				toast.error(render(created.message));
				flash('failed');
				return;
			}
			const outcome = await shareInvite(
				render(inviteShareMessage(wgName, created.invite.url)),
				created.invite.url,
			);
			if (outcome === 'cancelled') return;
			if (outcome === 'failed') toast.error(t('shareFailed'));
			flash(outcome);
		} finally {
			sharingRef.current = false;
			setSharing(false);
		}
	}

	const statusMessage =
		state === 'shared'
			? t('shared')
			: state === 'copied'
				? t('copied')
				: state === 'failed'
					? t('failedStatus')
					: '';

	return (
		<>
			<output aria-live="polite" className="sr-only">
				{statusMessage}
			</output>
			<Button
				type="button"
				variant={variant}
				onClick={onClick}
				disabled={sharing}
				className={cn('h-auto whitespace-normal', className)}
			>
				{sharing ? (
					<Spinner data-icon="inline-start" aria-hidden />
				) : state === 'copied' || state === 'shared' ? (
					<Check data-icon="inline-start" aria-hidden />
				) : state === 'failed' ? (
					<AlertTriangle data-icon="inline-start" aria-hidden />
				) : (
					<Share2 data-icon="inline-start" aria-hidden />
				)}
				{sharing
					? t('sharing')
					: state === 'copied'
						? t('copied')
						: state === 'shared'
							? t('shared')
							: state === 'failed'
								? t('shareAgain')
								: t('invite')}
			</Button>
		</>
	);
}
