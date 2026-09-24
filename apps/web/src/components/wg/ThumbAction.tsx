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
		if (!reserveSpace) return;
		const spacer = spacerRef.current;
		const action = actionRef.current;
		if (!spacer || !action) return;

		const syncHeight = () => {
			spacer.style.height = `${action.getBoundingClientRect().height + 12}px`;
		};
		syncHeight();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(syncHeight);
		observer.observe(action);
		return () => observer.disconnect();
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
