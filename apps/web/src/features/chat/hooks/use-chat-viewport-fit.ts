import { type RefObject, useEffect } from 'react';

/**
 * Sizes the chat frame to the visible phone viewport when the keyboard opens.
 * MessageScroller still owns all message/history scroll positioning.
 */
export function useChatViewportFit(chatRootRef: RefObject<HTMLElement | null>): void {
	// biome-ignore lint/correctness/useExhaustiveDependencies: the ref object is stable
	useEffect(() => {
		const viewport = window.visualViewport;
		const resolveFrame = (): HTMLElement | null =>
			chatRootRef.current?.closest<HTMLElement>('[data-chat-frame]') ?? null;
		let frame = resolveFrame();
		if (!frame) return;
		let chrome: HTMLElement | null = null;
		let chromeObserver: ResizeObserver | null = null;
		let shift = 0;

		// Re-resolved on every pass: React re-renders and app-chrome swaps must
		// not leave listeners or observers pointing at detached nodes.
		function syncChrome(): void {
			const next = document.querySelector<HTMLElement>('nav[data-app-chrome]');
			if (next === chrome) return;
			chromeObserver?.disconnect();
			chrome = next;
			if (chrome) {
				chromeObserver = new ResizeObserver(resize);
				chromeObserver.observe(chrome);
			}
		}

		function resize() {
			if (!frame?.isConnected) frame = resolveFrame();
			if (!frame) return;
			syncChrome();
			// When the layout viewport shrinks with the keyboard (interactive-widget=resizes-content,
			// iOS 27), offsetTop still reports the page scroll and would push the frame out of
			// view. There is no pan then, only the normal scroll.
			const top =
				viewport && window.innerHeight <= viewport.height + 1 ? 0 : (viewport?.offsetTop ?? 0);
			const bottom = top + (viewport?.height ?? window.innerHeight);
			// iOS keeps the fixed nav at the layout bottom, behind the keyboard, and
			// pans the visual viewport: only reserve the nav part that is visible.
			const nav = chrome?.getBoundingClientRect();
			const reserved = nav ? Math.max(0, bottom - Math.max(top, nav.top)) : 68;
			// The pan scrolls the frame's top (tabs, first messages) out of sight, so a
			// short chat looks empty. Pin the frame's top to the visible top instead.
			const base = frame.getBoundingClientRect().top - shift;
			shift = Math.max(0, top - base);
			frame.style.position = shift ? 'relative' : '';
			frame.style.top = shift ? `${shift}px` : '';
			// End the frame at the visible bottom, wherever the pan left its top.
			frame.style.height = `${Math.max(0, bottom - reserved - base - shift)}px`;
		}

		// The sticky offline banner sits above the frame and moves its top edge.
		const shell = frame.closest('main')?.parentElement;
		const shellObserver = new MutationObserver(resize);
		if (shell) shellObserver.observe(shell, { childList: true });

		syncChrome();
		resize();
		window.addEventListener('resize', resize);
		viewport?.addEventListener('resize', resize);
		viewport?.addEventListener('scroll', resize);
		return () => {
			chromeObserver?.disconnect();
			shellObserver.disconnect();
			window.removeEventListener('resize', resize);
			viewport?.removeEventListener('resize', resize);
			viewport?.removeEventListener('scroll', resize);
		};
	}, []);
}
