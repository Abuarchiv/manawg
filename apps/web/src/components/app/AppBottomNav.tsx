'use client';

import { type ComponentProps, useLayoutEffect, useRef } from 'react';

/** Reserve the actual floating navigation height, including wrapped/zoomed labels. */
export function AppBottomNav(props: ComponentProps<'nav'>) {
	const ref = useRef<HTMLElement>(null);
	useLayoutEffect(() => {
		const nav = ref.current;
		const frame = nav?.parentElement;
		if (!nav || !frame) return;
		const measure = () =>
			frame.style.setProperty('--app-nav-height', `${nav.getBoundingClientRect().height}px`);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(nav);
		return () => {
			observer.disconnect();
			frame.style.removeProperty('--app-nav-height');
		};
	}, []);
	return <nav ref={ref} {...props} />;
}
