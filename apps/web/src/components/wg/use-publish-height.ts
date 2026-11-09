import { useCallback, useRef } from 'react';

/**
 * Callback ref that publishes the element's live height as a CSS variable on <html> and
 * removes it again on unmount, so sticky chrome elsewhere can offset itself below the element.
 */
export function usePublishHeight(cssVar: `--${string}`): (el: HTMLElement | null) => void {
	const observerRef = useRef<ResizeObserver | null>(null);
	return useCallback(
		(el) => {
			observerRef.current?.disconnect();
			observerRef.current = null;
			const root = document.documentElement;
			if (!el) {
				root.style.removeProperty(cssVar);
				return;
			}
			const measure = () =>
				root.style.setProperty(cssVar, `${el.getBoundingClientRect().height}px`);
			measure();
			observerRef.current = new ResizeObserver(measure);
			observerRef.current.observe(el);
		},
		[cssVar],
	);
}
