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
import { LIST_REFRESH_INTERVAL_MS } from '@/core/utils/use-visibility-paused-interval';
import { dateTimeFormat } from '@/shared/i18n/intl';
import { type Message, useMessage } from '@/shared/i18n/message';
import posthog from '@/shared/lib/analytics';

/** setTimeout fires at once beyond 2^31 - 1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;
const REFRESH_GAP_MS = 5000;

/** A second tap may share a link the server confirmed this recently without asking again. */
const CHECKED_FOR_MS = 30_000;

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
	// The link the server confirmed on the last tap, for a second tap that shares without waiting.
	const checkedRef = useRef<{ id: string; at: number } | null>(null);
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
		// The WG's change poll rests in an idle tab, so a join without a push would leave the card.
		// One request per 30 s per open solo tab, which ends as soon as a second member joins.
		const poll = window.setInterval(() => {
			if (document.visibilityState === 'visible') setAttempt((n) => n + 1);
		}, LIST_REFRESH_INTERVAL_MS);
		return () => {
			window.clearInterval(poll);
			document.removeEventListener('visibilitychange', refresh);
			window.removeEventListener('focus', refresh);
		};
	}, []);

	async function share(): Promise<void> {
		if (sharing || state.status !== 'ready') return;
		setSharing(true);
		try {
			let invite = state.invite;
			const checked = checkedRef.current;
			checkedRef.current = null;
			// A revoked or used-up link must never go out, so the server confirms it first. A
			// confirmation from a tap moments ago lets this tap share inside its own gesture.
			if (!(checked?.id === invite.id && Date.now() - checked.at < CHECKED_FOR_MS)) {
				const current = await currentInvite(wg.shareCode, identity.memberId);
				if (!current.ok) {
					setState({ status: 'failed', message: current.message });
					return;
				}
				if (!current.invite) {
					void refreshMembers();
					return;
				}
				if (current.invite.id !== invite.id) {
					setState({ status: 'ready', invite: current.invite });
					setShared('fresh');
					return;
				}
				invite = current.invite;
				// A browser that ties the share sheet to the tap has spent it on the request.
				if (!tapStillActive()) {
					checkedRef.current = { id: invite.id, at: Date.now() };
					setShared('checked');
					return;
				}
			}
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
