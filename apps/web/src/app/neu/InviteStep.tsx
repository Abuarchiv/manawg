'use client';

import { AlertTriangle, ArrowRight, Check, Copy, MessageCircle, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ErrorBox } from '@/components/app/ErrorBox';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
	type CreatedInvite,
	createInvite,
	inviteShareText,
	shareInvite,
} from '@/components/wg/invite-share';
import { copyText } from '@/core/utils/clipboard';
import { INVITE_VALID_DAYS } from '@/core/utils/invite-token';
import { cn } from '@/shared/lib/cn';

const SHARE_RESET_MS = 1500;

type ShareState = 'idle' | 'copied' | 'linkCopied' | 'shared' | 'failed';

interface InviteStepProps {
	code: string;
	wgName: string;
	memberId: string;
	onSkip: () => void;
}

export function InviteStep({ code, wgName, memberId, onSkip }: InviteStepProps) {
	const [invite, setInvite] = useState<CreatedInvite | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<ShareState>('idle');
	const [sharing, setSharing] = useState(false);
	const timerRef = useRef<number | null>(null);
	const sharingRef = useRef(false);
	// Visually hidden live region so screen readers announce share state changes
	// without re-reading the entire button label each time.
	const liveId = 'share-status-live';

	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the request after an error; code and member never change in this step.
	useEffect(() => {
		let active = true;
		setLoadError(null);
		void createInvite(code, memberId).then((result) => {
			if (!active) return;
			if (result.ok) setInvite(result.invite);
			else setLoadError(result.message);
		});
		return () => {
			active = false;
		};
	}, [attempt]);

	useEffect(
		() => () => {
			if (timerRef.current) window.clearTimeout(timerRef.current);
		},
		[],
	);

	function flash(next: ShareState): void {
		setState(next);
		if (timerRef.current) window.clearTimeout(timerRef.current);
		timerRef.current = null;
		// Errors stay until the next action overwrites them.
		if (next === 'failed') return;
		timerRef.current = window.setTimeout(() => setState('idle'), SHARE_RESET_MS);
	}

	async function run(action: () => Promise<void>): Promise<void> {
		if (sharingRef.current) return;
		sharingRef.current = true;
		setSharing(true);
		try {
			await action();
		} finally {
			sharingRef.current = false;
			setSharing(false);
		}
	}

	const onShare = () =>
		run(async () => {
			if (!invite) return;
			const outcome = await shareInvite(wgName, invite.url);
			if (outcome === 'cancelled') setState('idle');
			else flash(outcome);
		});

	const onCopyLink = () =>
		run(async () => {
			if (!invite) return;
			flash((await copyText(invite.url)) ? 'linkCopied' : 'failed');
		});

	const whatsappHref = invite
		? `https://wa.me/?text=${encodeURIComponent(inviteShareText(wgName, invite.url))}`
		: undefined;
	const ready = invite !== null && !sharing;

	const shareLabel = sharing
		? 'Einladung wird geteilt…'
		: state === 'shared'
			? 'Einladung geteilt'
			: state === 'copied'
				? 'Einladung kopiert'
				: state === 'failed'
					? 'Teilen erneut versuchen'
					: 'Mitbewohner einladen';

	return (
		<div className="flex flex-col gap-5">
			{/* Visually hidden live region for share status announcements */}
			<span id={liveId} aria-live="polite" aria-atomic="true" className="sr-only">
				{state === 'shared'
					? 'Einladungslink wurde geteilt.'
					: state === 'copied'
						? 'Einladung wurde kopiert.'
						: state === 'linkCopied'
							? 'Einladungslink wurde kopiert.'
							: state === 'failed'
								? 'Teilen fehlgeschlagen. Kopiere den Link stattdessen.'
								: ''}
			</span>

			<Card>
				<CardHeader className="items-center text-center">
					<div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
						<Check aria-hidden />
					</div>
					<CardTitle className="max-w-full break-words">Eure WG „{wgName}“ ist live.</CardTitle>
					<CardDescription>
						Schick deiner WG den Einladungslink. Er gilt {INVITE_VALID_DAYS} Tage.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col items-center gap-3 text-center">
					{loadError ? (
						<div className="flex w-full flex-col gap-2">
							<ErrorBox>{loadError}</ErrorBox>
							<Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
								Erneut versuchen
							</Button>
						</div>
					) : (
						<Button
							type="button"
							variant="outline"
							onClick={() => void onCopyLink()}
							disabled={!ready}
							aria-label="Einladungslink kopieren"
							className="h-auto min-h-12 w-full justify-between gap-3 text-left"
						>
							<span className="min-w-0 truncate text-sm">
								{invite?.url ?? 'Link wird erstellt…'}
							</span>
							{invite ? (
								state === 'linkCopied' ? (
									<Check aria-hidden />
								) : (
									<Copy aria-hidden />
								)
							) : (
								<Spinner aria-hidden />
							)}
						</Button>
					)}
					<div className="flex min-h-6 items-center justify-center">
						{state === 'linkCopied' && <Badge variant="secondary">Link kopiert</Badge>}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Einladung verschicken</CardTitle>
					<CardDescription>
						Nutze die Teilen-Funktion deines Telefons oder kopiere den Link.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					<Button
						type="button"
						variant="default"
						size="lg"
						onClick={() => void onShare()}
						disabled={!ready}
						aria-label={shareLabel}
						aria-describedby={liveId}
						className="min-h-12 w-full"
					>
						{state === 'shared' || state === 'copied' ? (
							<Check data-icon="inline-start" aria-hidden />
						) : state === 'failed' ? (
							<AlertTriangle data-icon="inline-start" aria-hidden />
						) : (
							<Share2 data-icon="inline-start" aria-hidden />
						)}
						<span aria-hidden="true">{shareLabel}</span>
					</Button>
					<a
						href={whatsappHref}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Per WhatsApp teilen"
						aria-disabled={!ready}
						tabIndex={ready ? undefined : -1}
						onClick={(event) => {
							if (!ready) event.preventDefault();
						}}
						className={cn(
							buttonVariants({ variant: 'outline', size: 'lg' }),
							'min-h-12 w-full',
							!ready && 'pointer-events-none opacity-60',
						)}
					>
						<MessageCircle data-icon="inline-start" aria-hidden />
						Per WhatsApp teilen
					</a>
					<div className="flex min-h-6 items-center justify-center">
						{state === 'failed' && (
							<Badge variant="destructive" className="h-auto whitespace-normal text-center">
								Teilen fehlgeschlagen. Kopiere stattdessen den Link oben.
							</Badge>
						)}
					</div>
				</CardContent>
			</Card>

			<Button
				type="button"
				variant="outline"
				onClick={onSkip}
				disabled={sharing}
				className="w-full"
			>
				<ArrowRight data-icon="inline-start" aria-hidden />
				Zur WG
			</Button>
		</div>
	);
}
