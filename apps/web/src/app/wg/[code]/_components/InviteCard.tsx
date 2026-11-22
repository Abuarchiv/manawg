'use client';

import { Check, Share2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
	type CreatedInvite,
	currentInvite,
	inviteShareMessage,
	shareInvite,
} from '@/components/wg/invite-share';
import { useWg } from '@/components/wg/WgContextProvider';
import { dateTimeFormat } from '@/shared/i18n/intl';
import { type Message, useMessage } from '@/shared/i18n/message';
import posthog from '@/shared/lib/analytics';

/** setTimeout fires at once beyond 2^31 - 1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;

type CardState =
	| { status: 'loading' }
	| { status: 'ready'; invite: CreatedInvite }
	| { status: 'failed'; message: Message };

/**
 * The live invitation link of a WG that is still single-member, inside the Start card. Opening
 * the card fetches the newest link; the server creates a fresh one once that has died.
 */
export function InviteCard() {
	const t = useTranslations('home.inviteCard');
	const locale = useLocale();
	const render = useMessage();
	const { wg, identity, refreshMembers } = useWg();
	const [state, setState] = useState<CardState>({ status: 'loading' });
	const [attempt, setAttempt] = useState(0);
	const [shared, setShared] = useState<'shared' | 'copied' | 'failed' | null>(null);
	const [sharing, setSharing] = useState(false);
	const shownRef = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the request after a failure.
	useEffect(() => {
		let cancelled = false;
		setState({ status: 'loading' });
		void currentInvite(wg.shareCode, identity.memberId).then((result) => {
			if (cancelled) return;
			if (!result.ok) {
				setState({ status: 'failed', message: result.message });
				return;
			}
			// Someone joined since the roster was loaded: the roster refresh swaps the card out.
			if (!result.invite) {
				void refreshMembers();
				return;
			}
			setState({ status: 'ready', invite: result.invite });
			if (!shownRef.current) {
				shownRef.current = true;
				posthog.capture('invite_card_shown');
			}
		});
		return () => {
			cancelled = true;
		};
	}, [wg.shareCode, identity.memberId, refreshMembers, attempt]);

	// At its expiry the card fetches the replacement on its own.
	const expiresAt = state.status === 'ready' ? state.invite.expiresAt : null;
	useEffect(() => {
		if (!expiresAt) return;
		const delay = Math.min(new Date(expiresAt).getTime() - Date.now(), MAX_TIMEOUT_MS);
		const timer = window.setTimeout(() => setAttempt((n) => n + 1), Math.max(0, delay));
		return () => window.clearTimeout(timer);
	}, [expiresAt]);

	async function share(): Promise<void> {
		if (sharing) return;
		setSharing(true);
		try {
			// Revoked or expired since the card loaded: the server answers with the replacement.
			const current = await currentInvite(wg.shareCode, identity.memberId);
			if (!current.ok) {
				setState({ status: 'failed', message: current.message });
				return;
			}
			if (!current.invite) {
				void refreshMembers();
				return;
			}
			const invite = current.invite;
			setState({ status: 'ready', invite });
			const outcome = await shareInvite(
				render(inviteShareMessage(wg.name, invite.url, invite.expiresAt)),
			);
			if (outcome === 'cancelled') return;
			setShared(outcome);
			if (outcome !== 'failed') {
				posthog.capture('invite_card_shared', { method: outcome === 'shared' ? 'share' : 'copy' });
			}
		} finally {
			setSharing(false);
		}
	}

	if (state.status === 'failed') {
		return (
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-muted-foreground text-sm">{render(state.message)}</p>
				<Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
					{t('retry')}
				</Button>
			</div>
		);
	}

	const invite = state.status === 'ready' ? state.invite : null;
	const until = invite
		? dateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'Europe/Berlin' }).format(
				new Date(invite.expiresAt),
			)
		: '';

	return (
		<div className="flex flex-col gap-2" aria-busy={!invite}>
			{invite ? (
				<>
					<p
						data-invite-card-link
						className="text-foreground bg-muted rounded-md px-3 py-2 font-mono text-xs break-all"
					>
						{invite.url}
					</p>
					<p className="text-muted-foreground text-xs">{t('validUntil', { date: until })}</p>
				</>
			) : (
				<>
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-4 w-1/2" />
				</>
			)}
			<output aria-live="polite" className="sr-only">
				{shared ? t(shared) : ''}
			</output>
			<Button
				type="button"
				className="h-auto w-full whitespace-normal"
				disabled={!invite || sharing}
				aria-label={t('shareLabel', { wgName: wg.name })}
				onClick={() => void share()}
			>
				{sharing ? (
					<Spinner data-icon="inline-start" aria-hidden />
				) : shared === 'shared' || shared === 'copied' ? (
					<Check data-icon="inline-start" aria-hidden />
				) : (
					<Share2 data-icon="inline-start" aria-hidden />
				)}
				{t('share')}
			</Button>
		</div>
	);
}
