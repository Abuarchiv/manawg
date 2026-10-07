'use client';

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * One floating bottom navigation for the public shell and the WG shell: same
 * frame, same spacing, children are the NavItems. Reserves the actual height
 * as --app-nav-height, including wrapped/zoomed labels.
 */
export function AppBottomNav({ label, children }: { label: string; children: ReactNode }) {
	const ref = useRef<HTMLElement>(null);
	const [keyboardOpen, setKeyboardOpen] = useState(false);
	// iOS keeps fixed bars at the layout viewport, so with the keyboard open the bar floats mid-screen.
	// Hidden by collapsing to zero height at the viewport bottom (not display:none): a display:none
	// element reports an all-zero rect, and the chat frame fit would then reserve the whole
	// visible height for it and collapse to 0px. A zero-height rect at the bottom reserves nothing.
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		// The keyboard is open when the visual viewport is much shorter than the page height seen
		// before typing began. innerHeight alone is unreliable: Android (resizes-content) and iOS 27
		// shrink it together with the keyboard, so the difference stays near 0 or depends on event order.
		const pageHeight = () => Math.max(document.documentElement.clientHeight, vv.height);
		let base = pageHeight();
		const sync = (event?: Event) => {
			const el = document.activeElement;
			const typing =
				el instanceof HTMLElement && el.matches('input, textarea, [contenteditable="true"]');
			// Moving focus between fields blurs first while the keyboard is still up: keep the old base.
			if (!typing && event?.type !== 'focusout') base = pageHeight();
			setKeyboardOpen(typing && base - vv.height > 100);
		};
		sync();
		vv.addEventListener('resize', sync);
		vv.addEventListener('scroll', sync);
		window.addEventListener('resize', sync);
		window.addEventListener('orientationchange', sync);
		document.addEventListener('focusin', sync);
		document.addEventListener('focusout', sync);
		return () => {
			vv.removeEventListener('resize', sync);
			vv.removeEventListener('scroll', sync);
			window.removeEventListener('resize', sync);
			window.removeEventListener('orientationchange', sync);
			document.removeEventListener('focusin', sync);
			document.removeEventListener('focusout', sync);
		};
	}, []);
	useLayoutEffect(() => {
		const nav = ref.current;
		const frame = nav?.parentElement;
		if (!nav || !frame) return;
		const root = nav.ownerDocument.documentElement;
		const measure = () => {
			const height = `${nav.getBoundingClientRect().height}px`;
			frame.style.setProperty('--app-nav-height', height);
			root.style.setProperty('--app-nav-height', height);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(nav);
		return () => {
			observer.disconnect();
			frame.style.removeProperty('--app-nav-height');
			root.style.removeProperty('--app-nav-height');
		};
	}, []);
	return (
		<nav
			ref={ref}
			aria-label={label}
			data-app-chrome
			className={`fixed inset-x-0 bottom-0 z-30 mx-auto bg-background w-full min-w-0 max-w-[var(--app-nav-width)] px-2 ${keyboardOpen ? 'invisible h-0 overflow-hidden pb-0' : 'pb-[max(0.5rem,var(--safe-area-bottom,0px))]'}`}
		>
			<div className="rounded-[20px] border border-border bg-background text-foreground">
				<ul className="flex flex-wrap gap-0.5 p-0.5 [&>li]:min-w-fit [&>li]:flex-1">{children}</ul>
			</div>
		</nav>
	);
}
