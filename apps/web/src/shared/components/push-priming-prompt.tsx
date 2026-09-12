'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
	PUSH_PRIMING_DISMISS_KEY,
	isPushPrimingDismissed,
	shouldAutoResubscribePush,
	shouldShowPushPriming,
} from '@/core/notifications/push-priming';
import { subscribeWebPush } from '@/core/notifications/push-subscribe';
import { BellRing, X } from 'lucide-react';
import { useEffect, useState } from 'react';

function safeLocalStorage(): Storage | null {
	if (typeof window === 'undefined') return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function isEditingTarget(): boolean {
	const active = document.activeElement;
	return (
		active instanceof HTMLElement &&
		(active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
	);
}

function isPushSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'Notification' in window &&
		'serviceWorker' in navigator &&
		'PushManager' in window
	);
}

function rememberDismissed(): void {
	try {
		safeLocalStorage()?.setItem(PUSH_PRIMING_DISMISS_KEY, String(Date.now()));
	} catch {
		// Storage blocked (private mode etc.) — the prompt just won't persist its
		// dismissal across reloads this session; it still hides for now.
	}
}

/**
 * A one-time, non-blocking offer to turn on push notifications. Mounted for
 * every member with a resolved identity (see WgContextProvider), so it
 * naturally appears right after the moment a WG is created or joined for a
 * fresh device — without needing every join/create flow to know about it.
 *
 * Deliberately pinned to the TOP of the viewport, not the bottom: the
 * install-prompt banner and every composer (chat, pinnwand) already live
 * near the bottom nav, and a previous bug (see install-prompt.tsx's
 * `isEditingTarget` doc comment) came from a bottom-fixed banner sliding over
 * an in-progress keystroke. Living at the top avoids that class of bug by
 * construction instead of coordinating visibility with InstallPrompt.
 *
 * `Notification.requestPermission()` (inside `subscribeWebPush`) only ever
 * fires from the user's tap on "Ja, aktivieren" — never automatically. Most
 * browsers ignore/block an unsolicited call anyway, and a silent grant would
 * be the exact dark pattern app stores reject.
 */
export function PushPrimingPrompt({
	code,
	memberId,
	memberToken,
}: {
	code: string;
	memberId: string;
	memberToken?: string | undefined;
}) {
	const [visible, setVisible] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (typeof window === 'undefined') return;
		const supported = isPushSupported();
		const dismissed = isPushPrimingDismissed(
			safeLocalStorage()?.getItem(PUSH_PRIMING_DISMISS_KEY) ?? null,
		);
		// editingTarget is checked again at show-time and live below — typing can
		// start or stop between mount and the delayed show, so a single
		// mount-time snapshot isn't enough.
		const eligible = shouldShowPushPriming({
			supported,
			configured: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
			permission: supported ? Notification.permission : null,
			dismissed,
			editingTarget: false,
		});
		if (!eligible) return;
		// Small delay so it doesn't fight with whatever else the page is
		// animating in on first paint.
		const timer = window.setTimeout(() => {
			if (!isEditingTarget()) setVisible(true);
		}, 800);
		// Safety net: retract immediately if the card is already showing when the
		// user then taps into a composer, instead of sitting over the keystroke.
		const onFocusIn = () => {
			if (isEditingTarget()) setVisible(false);
		};
		window.addEventListener('focusin', onFocusIn);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener('focusin', onFocusIn);
		};
	}, []);

	// Silent background resubscribe: if permission was already granted at some
	// earlier point (a previous session, or a standing OS/browser grant) but
	// this device has no live subscription (fresh profile, cleared/expired
	// subscription), re-create it without any card or gesture — permission was
	// already cleared, so no dark pattern here. Never requests permission
	// itself (see shouldAutoResubscribePush); the first-ever grant still goes
	// through the tap above or Einstellungen. Runs independently of the
	// priming-card visibility/dismissal state above.
	useEffect(() => {
		if (typeof window === 'undefined') return;
		let cancelled = false;
		async function autoResubscribe(): Promise<void> {
			const supported = isPushSupported();
			const configured = !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
			const permission = supported ? Notification.permission : null;
			if (permission !== 'granted' || !configured) return;
			let hasSubscription = true;
			try {
				const registration = await navigator.serviceWorker.getRegistration();
				if (cancelled) return;
				const existing = await registration?.pushManager.getSubscription();
				if (cancelled) return;
				hasSubscription = !!existing;
			} catch {
				return;
			}
			if (!shouldAutoResubscribePush({ supported, configured, permission, hasSubscription })) {
				return;
			}
			try {
				await subscribeWebPush(code, memberId, memberToken);
			} catch {
				// Silent: VAPID misconfig, network hiccup, etc. Einstellungen still
				// offers a manual retry with a real error message.
			}
		}
		void autoResubscribe();
		return () => {
			cancelled = true;
		};
	}, [code, memberId, memberToken]);

	function dismiss(): void {
		rememberDismissed();
		setVisible(false);
	}

	async function enable(): Promise<void> {
		if (busy) return;
		setBusy(true);
		try {
			await subscribeWebPush(code, memberId, memberToken);
		} catch {
			// Denied, a mid-flight network hiccup, or push just isn't configured —
			// Einstellungen still offers a manual retry with a real error message;
			// no need to duplicate that UI in a one-shot priming card.
		} finally {
			setBusy(false);
			rememberDismissed();
			setVisible(false);
		}
	}

	if (!visible) return null;

	return (
		<div
			// biome-ignore lint/a11y/useSemanticElements: native <output> can't host a nested interactive button+dismiss layout cleanly (see install-prompt.tsx for the same tradeoff)
			role="status"
			aria-live="polite"
			aria-label="Benachrichtigungen aktivieren"
			// Breite wie beim Install-Banner an --app-frame-width gedeckelt, sonst
			// ragt das Overlay auf Desktop über die App-Spalte hinaus.
			className="fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[90] w-[calc(100%-1rem)] max-w-[calc(var(--app-frame-width)-1rem)] -translate-x-1/2 animate-in slide-in-from-top-4 fade-in duration-300"
		>
			<Card className="p-0 shadow-2xl">
				<CardContent className="flex items-start gap-3 p-4">
					<span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
						<BellRing className="h-4 w-4" aria-hidden />
					</span>

					<div className="min-w-0 flex-1">
						<p className="text-[14px] font-semibold text-card-foreground">
							Benachrichtigungen aktivieren (empfohlen)
						</p>
						<p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
							Alle Kategorien sind schon vorausgewählt — bekomme Bescheid bei neuen Nachrichten,
							Ausgaben und fälligen Aufgaben, direkt aufs Gerät. Einzelne Kategorien kannst du
							jederzeit in den Einstellungen abwählen.
						</p>
						<Button
							type="button"
							onClick={() => void enable()}
							disabled={busy}
							className="mt-3 min-h-11 rounded-full px-4 text-[13px]"
						>
							{busy && <Spinner className="size-3.5" aria-hidden />}
							Ja, aktivieren
						</Button>
					</div>

					<Button
						variant="ghost"
						size="icon-lg"
						type="button"
						onClick={dismiss}
						aria-label="Hinweis schließen"
						className="size-11 shrink-0 rounded-full text-muted-foreground"
					>
						<X className="h-4 w-4" aria-hidden />
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
