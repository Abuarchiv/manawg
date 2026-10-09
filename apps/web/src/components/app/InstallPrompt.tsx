'use client';

import { LogoMark } from '@/components/ui/LogoMark';
import { useHasToasts } from '@/components/ui/Toast';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { isEditingTarget } from '@/core/utils/browser';
import {
	type BeforeInstallEvent,
	isAppInstalled,
	subscribeInstall,
	triggerInstall,
} from '@/shared/lib/pwa-install';
import { X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { InstallButton } from './InstallButton';

// Not under `manawg:`/`manawg_`: signing out wipes those, and a dismissal is a device choice.
const DISMISSED_KEY = 'manawg-install-dismissed-at';
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
	try {
		const at = Number(localStorage.getItem(DISMISSED_KEY));
		return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_COOLDOWN_MS;
	} catch {
		return false;
	}
}

/**
 * Floating install prompt — shown on the start page of every app start until
 * ManaWG is installed.
 * Dismissing hides it for two weeks. Browsers without a native prompt
 * (iOS, Firefox) get the manual steps from `InstallButton`. Reads the
 * `beforeinstallprompt` event from the global pub/sub module
 * (`@/shared/lib/pwa-install`) so it cannot race the `InstallButton` in the
 * settings.
 *
 * Implementation note: rendered as a normal div (not <dialog>) — toggling the
 * `open` attribute on a native dialog flips `display:none` and breaks the
 * slide-in animation. The prompt sits above the BottomNav and respects the
 * iOS safe-area-bottom so it doesn't sit under the home-indicator bar.
 */
export function InstallPrompt() {
	const [event, setEvent] = useState<BeforeInstallEvent | null>(null);
	const [manual, setManual] = useState(false);
	const [hidden, setHidden] = useState(true);
	const pathname = usePathname() ?? '';
	// Every app start lands on a start page. Feature pages keep their composer
	// or primary action right above the BottomNav, where the prompt would sit.
	const onStartPage = pathname === '/' || /^\/wg\/[^/]+\/?$/.test(pathname);

	useEffect(() => {
		if (isAppInstalled() || dismissedRecently()) return;

		// Chromium fires beforeinstallprompt only while the app is not installed,
		// so there we wait for it. Other browsers can only install manually.
		setManual(!('onbeforeinstallprompt' in window));
		const timer = window.setTimeout(() => {
			if (!isEditingTarget()) setHidden(false);
		}, 1200);

		// Retract the prompt when the user taps into a composer so it never
		// sits over the input or its send button.
		const onFocusIn = () => {
			if (isEditingTarget()) setHidden(true);
		};
		window.addEventListener('focusin', onFocusIn);

		const unsub = subscribeInstall((ev) => {
			setEvent(ev);
			if (!ev && isAppInstalled()) setHidden(true);
		});

		return () => {
			window.removeEventListener('focusin', onFocusIn);
			window.clearTimeout(timer);
			unsub();
		};
	}, []);

	const visible = !(hidden || !onStartPage || (!event && !manual));
	// A toast lands on the same baseline above the nav. The prompt steps aside while one is
	// shown (invisible, not unmounted: it keeps its reserved room, so the page does not jump).
	const toastOpen = useHasToasts();
	const promptRef = useRef<HTMLDivElement>(null);
	// The prompt is fixed and covers the page end (legal links, last cards). While it is
	// shown, publish its height so the app frame reserves that room (see globals.css 1c).
	useLayoutEffect(() => {
		const el = promptRef.current;
		if (!visible || !el) return;
		const root = document.documentElement;
		const publish = () =>
			root.style.setProperty('--install-prompt-space', `${el.offsetHeight + 8}px`);
		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(el);
		return () => {
			observer.disconnect();
			root.style.removeProperty('--install-prompt-space');
		};
	}, [visible]);

	const dismiss = () => {
		// The focused button unmounts with the prompt; hand focus to the page instead of <body>.
		if (promptRef.current?.contains(document.activeElement))
			document.getElementById('main')?.focus({ preventScroll: true });
		setHidden(true);
		try {
			localStorage.setItem(DISMISSED_KEY, String(Date.now()));
		} catch {
			// Without storage the prompt simply returns on the next visit.
		}
	};

	const install = async () => {
		const result = await triggerInstall();
		if (result !== 'unavailable') dismiss();
	};

	if (!visible) return null;

	return (
		<div
			ref={promptRef}
			data-install-prompt
			className={`fixed inset-x-0 z-40 mx-auto w-[calc(100%-1rem)] max-w-[calc(var(--app-frame-width)-1rem)] animate-in fade-in slide-in-from-bottom-2 duration-[220ms] ${toastOpen ? 'invisible' : ''}`}
			// Use the measured BottomNav height so wrapped labels and zoomed text leave room.
			style={{ bottom: 'calc(var(--app-nav-height, 5rem) + 0.5rem)' }}
		>
			<section aria-live="polite" aria-label="App installieren">
				{/* Compact instead of a tall card: covers as little content above the navigation as possible. */}
				<Card size="sm" className="gap-2 px-3 py-2.5">
					<div className="flex min-w-0 items-center gap-2.5">
						<LogoMark
							size={28}
							radius={10}
							tileFill="var(--primary)"
							markFill="var(--primary-foreground)"
							className="shrink-0"
						/>
						<div className="min-w-0 flex-1">
							<CardTitle className="text-sm">ManaWG als App installieren</CardTitle>
							<CardDescription className="text-meta">
								Schneller starten, offline-fähig.
							</CardDescription>
						</div>
						<Button
							type="button"
							onClick={dismiss}
							variant="ghost"
							size="icon-sm"
							aria-label="Installationshinweis ausblenden"
							className="shrink-0"
						>
							<X aria-hidden="true" />
						</Button>
					</div>
					{event ? (
						<Button type="button" size="sm" onClick={install} className="w-full">
							Jetzt installieren
						</Button>
					) : (
						<InstallButton variant="solid" label="So installierst du ManaWG" className="w-full" />
					)}
				</Card>
			</section>
		</div>
	);
}
