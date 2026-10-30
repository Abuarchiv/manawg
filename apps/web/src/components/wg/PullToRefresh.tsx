'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { haptic } from '@/shared/lib/haptics';

const THRESHOLD = 72;
const MAX_PULL = 96;

/** True when the touch starts inside something that scrolls on its own or sits in an open overlay. */
function blocked(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return true;
	if (target.closest('[role="dialog"], [role="alertdialog"], input, textarea, select')) return true;
	for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
		if (el.scrollTop > 0) return true;
	}
	return false;
}

/**
 * Pull down at the top of a WG page to reload its data. The page has no native pull-to-refresh
 * (overscroll-behavior: none, and installed iOS apps never had one). Every data hook already
 * reloads on window focus, so a release past the threshold replays that focus event.
 */
export function PullToRefresh() {
	const [pull, setPull] = useState(0);
	const [busy, setBusy] = useState(false);
	const start = useRef<number | null>(null);
	const pullRef = useRef(0);

	useEffect(() => {
		const set = (v: number) => {
			pullRef.current = v;
			setPull(v);
		};
		const onStart = (e: TouchEvent) => {
			start.current =
				window.scrollY <= 0 && e.touches.length === 1 && !blocked(e.target)
					? (e.touches[0]?.clientY ?? null)
					: null;
		};
		const onMove = (e: TouchEvent) => {
			if (start.current === null) return;
			const dy = (e.touches[0]?.clientY ?? start.current) - start.current;
			if (dy <= 0 || window.scrollY > 0) {
				start.current = null;
				set(0);
				return;
			}
			const next = Math.min(MAX_PULL, dy * 0.5);
			if (pullRef.current < THRESHOLD && next >= THRESHOLD) haptic('light');
			set(next);
		};
		const onEnd = () => {
			if (start.current === null) return;
			start.current = null;
			if (pullRef.current >= THRESHOLD) {
				setBusy(true);
				window.dispatchEvent(new Event('focus'));
				window.setTimeout(() => setBusy(false), 700);
			}
			set(0);
		};
		document.addEventListener('touchstart', onStart, { passive: true });
		document.addEventListener('touchmove', onMove, { passive: true });
		document.addEventListener('touchend', onEnd);
		document.addEventListener('touchcancel', onEnd);
		return () => {
			document.removeEventListener('touchstart', onStart);
			document.removeEventListener('touchmove', onMove);
			document.removeEventListener('touchend', onEnd);
			document.removeEventListener('touchcancel', onEnd);
		};
	}, []);

	const offset = busy ? THRESHOLD * 0.75 : pull;
	if (offset <= 0) return null;
	return (
		<div
			aria-hidden
			className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
			style={{ transform: `translateY(calc(env(safe-area-inset-top) + ${offset - 40}px))` }}
		>
			<span className="flex size-9 items-center justify-center rounded-full border bg-background shadow-sm">
				<RefreshCw
					className={busy ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'}
					style={busy ? undefined : { transform: `rotate(${(pull / THRESHOLD) * 270}deg)` }}
					strokeWidth={pull >= THRESHOLD || busy ? 2.5 : 1.75}
				/>
			</span>
		</div>
	);
}
