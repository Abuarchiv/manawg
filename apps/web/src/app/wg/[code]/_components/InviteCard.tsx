'use client';

import { Check, Share2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
	type CreatedInvite,
	copyWhenReady,
	currentInvite,
	inviteShareMessage,
	type ShareOutcome,
	shareInvite,
} from '@/components/wg/invite-share';
import { useWg } from '@/components/wg/WgContextProvider';
import { pollWgChangesNow, useWgChange } from '@/core/sync/wg-changes';
import { isIdle, LIST_REFRESH_INTERVAL_MS } from '@/core/utils/use-visibility-paused-interval';
import { dateTimeFormat } from '@/shared/i18n/intl';
import { type Message, useMessage } from '@/shared/i18n/message';
import posthog from '@/shared/lib/analytics';

/** setTimeout fires at once beyond 2^31 - 1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;
const REFRESH_GAP_MS = 5000;

/**
 * While the card is in front and in use, the WG's change poll runs this often, so a join or a
 * revoke elsewhere shows within seconds; hidden or idle tabs fall back to every 30 s. Solo tabs
 * only: the card leaves with the second member.
 */
const LIVE_POLL_MS = 3000;

type Notice = 'shared' | 'copied' | 'failed' | 'checked' | 'fresh';

/** `navigator.userActivation` where the browser has it: is the tap still usable after a wait? */
function tapStillActive(): boolean {
	const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
		.userActivation;
	return activation ? activation.isActive : true;
}

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
	const [shared, setShared] = useState<Notice | null>(null);
	// This browser lost a tap to the check before: later taps copy, which can wait for the check.
	const strictRef = useRef(false);
	const [sharing, setSharing] = useState(false);
	const shownRef = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the request after a failure.
	useEffect(() => {
		let cancelled = false;
		// A refresh keeps the shown link until the answer is in.
		setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
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

	// Back in front: a flatmate may have joined or the link been revoked meanwhile.
	// Switching tabs fires both events; one request per return is enough.
	useEffect(() => {
		let last = 0;
		const refresh = () => {
			if (document.visibilityState !== 'visible' || Date.now() - last < REFRESH_GAP_MS) return;
			last = Date.now();
			setAttempt((n) => n + 1);
		};
		document.addEventListener('visibilitychange', refresh);
		window.addEventListener('focus', refresh);
		// A join moves the roster version, which swaps the card out; a revoke moves `data` (below).
		let polled = Date.now();
		const poll = window.setInterval(() => {
			const live = document.visibilityState === 'visible' && !isIdle();
			if (!live && Date.now() - polled < LIST_REFRESH_INTERVAL_MS) return;
			polled = Date.now();
			pollWgChangesNow();
		}, LIVE_POLL_MS);
		return () => {
			window.clearInterval(poll);
			document.removeEventListener('visibilitychange', refresh);
			window.removeEventListener('focus', refresh);
		};
	}, []);
	// Any other write, an invitation revoked elsewhere among them: show the link the server has now.
	useWgChange('data', () => setAttempt((n) => n + 1));

	/** The server's answer for the shown link: it, or null once it is dead (the card updates). */
	async function confirmShown(shown: CreatedInvite): Promise<CreatedInvite | null> {
		const current = await currentInvite(wg.shareCode, identity.memberId);
		if (!current.ok) {
			setState({ status: 'failed', message: current.message });
			return null;
		}
		if (!current.invite) {
			void refreshMembers();
			return null;
		}
		if (current.invite.id !== shown.id) {
			setState({ status: 'ready', invite: current.invite });
			setShared('fresh');
			return null;
		}
		return current.invite;
	}

	async function share(): Promise<void> {
		if (sharing || state.status !== 'ready') return;
		const shown = state.invite;
		// Expiry needs no server: a dead link reloads and is never shared.
		if (new Date(shown.expiresAt).getTime() <= Date.now()) {
			setShared(null);
			setAttempt((n) => n + 1);
			return;
		}
		setSharing(true);
		try {
			// Every tap asks the server first, so a revoked or used-up link never goes out.
			const confirmed = confirmShown(shown);
			const message = (invite: CreatedInvite) =>
				render(inviteShareMessage(wg.name, invite.url, invite.expiresAt));
			let outcome: ShareOutcome;
			if (strictRef.current) {
				// Started inside the tap; it copies only what the check confirms.
				outcome = await copyWhenReady(confirmed.then((invite) => invite && message(invite)));
			} else {
				const invite = await confirmed;
				if (!invite) return;
				// A browser that ties the share sheet to the tap has spent it on the request.
				if (!tapStillActive()) {
					strictRef.current = true;
					setShared('checked');
					return;
				}
				outcome = await shareInvite(message(invite));
			}
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
			<output
				aria-live="polite"
				// The check icon shows success; anything that asks for action needs words on screen.
				className={
					shared === 'failed'
						? 'text-destructive text-xs'
						: shared === 'checked' || shared === 'fresh'
							? 'text-muted-foreground text-xs'
							: 'sr-only'
				}
			>
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
