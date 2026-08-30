'use client';

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
		if (isDismissed()) return;
		if (isAppInstalled()) return;

		const ua = window.navigator.userAgent.toLowerCase();
		const isIos = /iphone|ipad|ipod/.test(ua);
		const isSafari = isIos && /safari/.test(ua) && !/crios|fxios|edgios/.test(ua);

		const showWhenReady = () => {
			if (!hasScrolled.current && !inWgApp) return;
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
			if (inWgApp) {
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

	if (hidden) return null;
	if (!event && !iosHint) return null;

	return (
		<div
			// biome-ignore lint/a11y/useSemanticElements: native <dialog> UA display:none kills CSS transitions (see native-dialog-css-transition-kill skill)
			role="status"
			aria-live="polite"
			aria-label="App installieren"
			// Breite an den App-Frame gekoppelt: max-w-lg (32rem) war breiter als
			// --app-frame-width, das Banner ragte auf Desktop beidseitig über die
			// App-Spalte hinaus — dieselbe Deckelung wie bei der Bottom-Nav.
			className="fixed left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-1rem)] max-w-[calc(var(--app-frame-width)-1rem)] animate-in slide-in-from-bottom-4 fade-in duration-300"
			style={{
				// In /wg/* the bottom nav is fixed (NavItem min-h 48px + safe-area).
				// Lift the prompt above it; outside the WG app stick close to the edge.
				bottom: inWgApp
					? 'calc(env(safe-area-inset-bottom, 0px) + 4.5rem)'
					: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
			}}
		>
			<div className="rounded-3xl border border-[var(--border)] bg-[var(--bg-base)] p-4 text-[var(--text-1)] shadow-2xl sm:p-5">
				<div className="flex items-start gap-3">
					<LogoMark size={44} radius={12} className="shrink-0" />

					<div className="flex-1 min-w-0">
						<p className="text-base font-semibold tracking-[-0.02em] text-[var(--text-1)]">
							{iosHint ? 'Auf dem Home-Bildschirm installieren' : 'ManaWG als App installieren'}
						</p>
						<p className="mt-1.5 text-sm leading-relaxed text-[var(--text-2)]">
							{iosHint ? (
								<>
									Tippe auf <span className="font-semibold text-[var(--text-1)]">Teilen</span> und
									dann{' '}
									<span className="font-semibold text-[var(--text-1)]">Zum Home-Bildschirm</span>.
								</>
							) : (
								'Wie eine App. Schneller starten, offline-fähig, kein Browser-Tab nötig.'
							)}
						</p>
						{!iosHint && event && (
							<button
								type="button"
								onClick={install}
								className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--text-1)] px-4 py-2 text-sm font-semibold text-[var(--bg-base)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								Jetzt installieren
							</button>
						)}
					</div>

					<button
						type="button"
						onClick={dismiss}
						aria-label="Installationshinweis ausblenden"
						className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-[var(--surface)] p-2.5 text-[var(--text-3)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</button>
				</div>
			</div>
		</div>
	);
}
