'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/Toast';
import { apiFetch } from '@/core/infra/api-client';
import {
	isPushOptedOut,
	isPushPrimingDismissed,
	PUSH_PRIMING_DISMISS_KEY,
	shouldAutoResubscribePush,
	shouldShowPushPriming,
} from '@/core/notifications/push-priming';
import {
	isPushSupported,
	persistExistingWebPushSubscription,
	subscribeWebPush,
} from '@/core/notifications/push-subscribe';
import { isEditingTarget, safeLocalStorage } from '@/core/utils/browser';

function rememberDismissed(): void {
	try {
		safeLocalStorage()?.setItem(PUSH_PRIMING_DISMISS_KEY, String(Date.now()));
	} catch {
		// Storage blocked (private mode): the dismissal is not persisted.
	}
}

/**
 * One-time inline offer to enable push. Mounted for every member with a resolved identity
 * (see app/wg/[code]/page.tsx), so it shows up on a fresh device without join/create flows
 * knowing about it. `Notification.requestPermission()` runs only from the member's tap on the
 * card, never automatically.
 */
export function PushPrimingPrompt({ code, memberId }: { code: string; memberId: string }) {
	const t = useTranslations('shell.pushPriming');
	const [visible, setVisible] = useState(false);
	const [busy, setBusy] = useState(false);
	const [activationError, setActivationError] = useState<string | null>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const toast = useToast();

	// The card sits at the page end: the error line makes it taller, so bring it fully back
	// into view (above the bottom navigation, see scroll-mb on the card).
	useEffect(() => {
		if (activationError) cardRef.current?.scrollIntoView({ block: 'nearest' });
	}, [activationError]);

	useEffect(() => {
		const supported = isPushSupported();
		const dismissed = isPushPrimingDismissed(
			safeLocalStorage()?.getItem(PUSH_PRIMING_DISMISS_KEY) ?? null,
		);
		// Typing can start between mount and show, so editingTarget is rechecked below.
		const eligible = shouldShowPushPriming({
			supported,
			configured: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
			permission: supported ? Notification.permission : null,
			dismissed,
			editingTarget: false,
		});
		if (!eligible) return;
		if (!isEditingTarget()) setVisible(true);
		// Retract immediately if the user starts editing while the offer is visible.
		const onFocusIn = () => {
			if (isEditingTarget()) setVisible(false);
		};
		window.addEventListener('focusin', onFocusIn);
		return () => {
			window.removeEventListener('focusin', onFocusIn);
		};
	}, []);

	// Re-creates a lost subscription silently when permission is already granted (see
	// shouldAutoResubscribePush). Never requests permission; the first grant goes through the
	// card or Settings. Independent of the card state above.
	useEffect(() => {
		let cancelled = false;
		async function autoResubscribe(): Promise<void> {
			const supported = isPushSupported();
			const configured = !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
			const permission = supported ? Notification.permission : null;
			if (permission !== 'granted' || !configured) return;
			let existing: PushSubscription | null | undefined;
			try {
				const registration = await navigator.serviceWorker.getRegistration();
				if (cancelled) return;
				existing = await registration?.pushManager.getSubscription();
				if (cancelled) return;
			} catch {
				return;
			}
			const hasSubscription = !!existing;
			// One browser subscription serves every WG of the account. A WG joined (or rejoined)
			// after push was turned on has never seen it, so hand it over once the server says off.
			if (existing && !isPushOptedOut(memberId)) {
				const status = await apiFetch<{ pushOptIn: boolean }>(
					`/api/wg/${encodeURIComponent(code)}/notifications`,
					{ memberId },
				);
				if (cancelled || !status.ok || status.data.pushOptIn !== false) return;
				try {
					await persistExistingWebPushSubscription(code, memberId, existing);
				} catch {
					// Silent like the resubscribe below; Settings retries with a real error.
				}
				return;
			}
			if (
				!shouldAutoResubscribePush({
					supported,
					configured,
					permission,
					hasSubscription,
					optedOut: isPushOptedOut(memberId),
				})
			) {
				return;
			}
			try {
				await subscribeWebPush(code, memberId);
			} catch {
				// Silent: VAPID misconfig, network hiccup, etc. Settings still
				// offers a manual retry with a real error message.
			}
		}
		void autoResubscribe();
		return () => {
			cancelled = true;
		};
	}, [code, memberId]);

	// The focused button leaves the DOM with the card; park focus on the page instead of <body>.
	function hideCard(): void {
		rememberDismissed();
		setVisible(false);
		document.getElementById('main')?.focus({ preventScroll: true });
	}

	async function enable(): Promise<void> {
		if (busy) return;
		setBusy(true);
		setActivationError(null);
		try {
			await subscribeWebPush(code, memberId);
			hideCard();
			toast.success(t('enabled'));
		} catch {
			setActivationError(t('activationFailed'));
		} finally {
			setBusy(false);
		}
	}

	if (!visible) return null;

	return (
		<div
			role="status"
			aria-live="polite"
			aria-label={t('label')}
			ref={cardRef}
			className="flex w-full scroll-mb-[calc(var(--app-nav-height,5rem)+0.5rem)] flex-wrap items-center gap-3 rounded-xl border p-3"
		>
			<div className="min-w-0 flex-1 basis-48">
				<p className="text-sm font-medium">{t('title')}</p>
				<p className="text-meta text-muted-foreground">{t('description')}</p>
				{activationError && (
					<p role="alert" className="text-sm text-destructive">
						{activationError}
					</p>
				)}
			</div>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => void enable()}
					aria-disabled={busy}
					className="aria-disabled:opacity-50"
				>
					{busy && <Spinner data-icon="inline-start" aria-hidden />}
					{t('enable')}
				</Button>
				<Button
					variant="ghost"
					size="icon"
					type="button"
					onClick={hideCard}
					aria-label={t('dismiss')}
					className="text-muted-foreground"
				>
					<X aria-hidden />
				</Button>
			</div>
		</div>
	);
}
