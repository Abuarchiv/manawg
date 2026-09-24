'use client';

import { type ReactNode, useLayoutEffect, useRef } from 'react';

export function ThumbAction({
	children,
	reserveSpace = true,
}: {
	children: ReactNode;
	reserveSpace?: boolean;
}) {
	const spacerRef = useRef<HTMLDivElement>(null);
	const actionRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const action = actionRef.current;
		if (!action) return;
		const root = document.documentElement;

		// Toasts read --thumb-action-space so they stack above this bar instead of covering it.
		const syncHeight = () => {
			const height = action.getBoundingClientRect().height;
			root.style.setProperty('--thumb-action-space', `${height + 8}px`);
			if (reserveSpace && spacerRef.current) {
				spacerRef.current.style.height = `${height + 12}px`;
			}
		};
		syncHeight();
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncHeight);
		observer?.observe(action);
		return () => {
			observer?.disconnect();
			root.style.removeProperty('--thumb-action-space');
		};
	}, [reserveSpace]);

	return (
		<>
			{reserveSpace && <div ref={spacerRef} aria-hidden className="h-14 shrink-0" />}
			<div
				ref={actionRef}
				data-page-primary-action
				className="fixed inset-x-0 bottom-[calc(var(--app-nav-height,5rem)+0.5rem)] z-20 mx-auto w-full max-w-[var(--app-nav-width)] px-4"
			>
				{children}
			</div>
		</>
	);
}
