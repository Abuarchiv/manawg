'use client';

import { Button } from '@/components/ui/button';
import {
	Card,
	CardAction,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
	INSTALL_DISMISS_KEY,
	createInstallDismissedAt,
	isInstallDismissed,
} from '../lib/install-dismissal';
import {
	type BeforeInstallEvent,
	isAppInstalled,
	isIosLikeDevice,
	subscribeInstall,
	triggerInstall,
} from '../lib/pwa-install';
import { LogoMark } from './ui/LogoMark';

function isDismissed(): boolean {
	const storage = safeLocalStorage();
	if (!storage) return false;
	return isInstallDismissed(storage.getItem(INSTALL_DISMISS_KEY));
}

function safeLocalStorage(): Storage | null {
	if (typeof window === 'undefined') return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function rememberDismissed(): void {
	try {
		const storage = safeLocalStorage();
		if (!storage) return;
		storage.setItem(INSTALL_DISMISS_KEY, createInstallDismissedAt());
	} catch {
		// If storage is blocked, just hide for this session.
	}
}

/**
 * True while the user has an input/textarea/contentEditable focused — e.g.
 * typing a chat message. The prompt is fixed just above the BottomNav, which
 * is exactly where feature composers (chat, pinnwand) sit, so popping up
 * unconditionally can slide the prompt over an in-progress keystroke and eat
 * the tap meant for the composer's send button.
 */
function isEditingTarget(): boolean {
	const active = document.activeElement;
	return (
		active instanceof HTMLElement &&
		(active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
	);
}

/**
 * Floating install prompt — appears only after user has scrolled past the hero
 * (so it never blocks the CTAs). Honors a 14-day dismissal cooldown via
 * localStorage which is checked before any event handlers are registered.
 * iOS users see a manual hint. Liest das `beforeinstallprompt`-Event aus dem
 * globalen Pub/Sub-Modul (`../lib/pwa-install`), damit kein Race-Condition mit
 * dem Hero-`InstallButton` entsteht.
 *
 * Implementation note: rendered as a normal div (not <dialog>) — toggling the
 * `open` attribute on a native dialog flips `display:none` and breaks the
 * slide-in animation. The prompt is centered above the BottomNav and respects
 * the iOS safe-area-bottom so it doesn't sit under the home-indicator bar.
 */
export function InstallPrompt() {
	const pathname = usePathname();
	const [event, setEvent] = useState<BeforeInstallEvent | null>(null);
	const [iosHint, setIosHint] = useState(false);
	const [hidden, setHidden] = useState(true);
	const hasScrolled = useRef(false);
	const inWgApp = pathname?.startsWith('/wg/') ?? false;

	useEffect(() => {
		if (typeof window === 'undefined') return;
		// In-app forms and navigation must remain unobstructed. Installation is
		// available on demand in settings; the automatic prompt is for entry only.
		if (inWgApp) return;
		if (isDismissed()) return;
		if (isAppInstalled()) return;

		const ua = window.navigator.userAgent.toLowerCase();
		const isIos = isIosLikeDevice(window.navigator);
		const isSafari = isIos && /safari/.test(ua) && !/crios|fxios|edgios/.test(ua);

		const showWhenReady = () => {
			if (!hasScrolled.current && !inWgApp) return;
			if (isDismissed()) return;
			if (isEditingTarget()) return;
			if (event) {
				setHidden(false);
				return;
			}
			if (isSafari) {
				setIosHint(true);
				setHidden(false);
			}
		};

		const onScroll = () => {
			if (!hasScrolled.current && window.scrollY > 80) {
				hasScrolled.current = true;
				showWhenReady();
			}
			// Hide near the bottom CTAs so the install prompt does not overlap primary actions.
			const distToBottom =
				document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
			if (distToBottom < 600) {
				setHidden(true);
			} else if (
				hasScrolled.current &&
				(event || isSafari) &&
				!isDismissed() &&
				!isEditingTarget()
			) {
				setHidden(false);
			}
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		const timer = window.setTimeout(() => {
			// The user may have dismissed the prompt while this timer was
			// pending — re-showing it 1.2s later would undo that dismissal.
			if (inWgApp && !isDismissed()) {
				hasScrolled.current = true;
				showWhenReady();
			}
		}, 1200);

		// Covers the reverse ordering: the prompt is already showing (from an
		// earlier trigger) when the user then taps into a composer — retract it
		// immediately instead of leaving it sitting over the input.
		const onFocusIn = (e: FocusEvent) => {
			if (e.target instanceof HTMLElement && isEditingTarget()) {
				setHidden(true);
			}
		};
		window.addEventListener('focusin', onFocusIn);

		const unsub = subscribeInstall((ev) => {
			setEvent(ev);
			if (ev && hasScrolled.current && !isDismissed() && !isEditingTarget()) {
				setHidden(false);
			}
			if (!ev && isAppInstalled()) {
				rememberDismissed();
				setHidden(true);
			}
		});

		return () => {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('focusin', onFocusIn);
			window.clearTimeout(timer);
			unsub();
		};
	}, [event, inWgApp]);

	const dismiss = () => {
		rememberDismissed();
		setHidden(true);
	};

	const install = async () => {
		const result = await triggerInstall();
		if (result === 'accepted') {
			rememberDismissed();
			setHidden(true);
		} else if (result === 'dismissed') {
			dismiss();
		}
	};

	if (hidden || inWgApp) return null;
	if (!event && !iosHint) return null;

	return (
		<div
			className="fixed inset-x-0 z-40 mx-auto w-[calc(100%-1rem)] max-w-[calc(var(--app-frame-width)-1rem)] animate-in fade-in slide-in-from-bottom-4 duration-300"
			style={{
				// In /wg/* the bottom nav is fixed (NavItem min-h 48px + safe-area).
				// Lift the prompt above it; outside the WG app stick close to the edge.
				bottom: inWgApp
					? 'calc(env(safe-area-inset-bottom, 0px) + 4.5rem)'
					: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
			}}
		>
			<section aria-live="polite" aria-label="App installieren">
				<Card
					size="sm"
					className="max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-6rem)] overflow-y-auto"
				>
					<CardHeader>
						<div className="flex min-w-0 items-center gap-3">
							<LogoMark
								size={32}
								radius={12}
								tileFill="var(--primary)"
								markFill="var(--primary-foreground)"
								className="shrink-0"
							/>
							<CardTitle>
								{iosHint ? 'Auf dem Home-Bildschirm installieren' : 'ManaWG als App installieren'}
							</CardTitle>
						</div>
						<CardDescription>
							{iosHint ? (
								<>
									Tippe auf <span className="font-medium text-foreground">Teilen</span> und dann{' '}
									<span className="font-medium text-foreground">Zum Home-Bildschirm</span>.
								</>
							) : (
								'Wie eine App. Schneller starten, offline-fähig, kein Browser-Tab nötig.'
							)}
						</CardDescription>
						<CardAction>
							<Button
								type="button"
								onClick={dismiss}
								variant="ghost"
								size="icon"
								aria-label="Installationshinweis ausblenden"
								className="size-11"
							>
								<X aria-hidden="true" />
							</Button>
						</CardAction>
					</CardHeader>
					{!iosHint && event && (
						<CardFooter>
							<Button
								type="button"
								onClick={install}
								className="h-auto min-h-11 w-full whitespace-normal py-2"
							>
								Jetzt installieren
							</Button>
						</CardFooter>
					)}
				</Card>
			</section>
		</div>
	);
}
