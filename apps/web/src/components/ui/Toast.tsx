'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { haptic } from '@/shared/lib/haptics';
import { CheckCircle, Info, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

type ToastVariant = 'success' | 'error' | 'info';

interface Toast {
	id: string;
	message: string;
	variant: ToastVariant;
}

// WCAG 2.2.1: a toast must give enough time to read it. The auto-dismiss timer
// lives in ToastItem (not here) so it can pause while hovered or focused.
const TOAST_DURATION_MS = 4000;

/** Module-level store: toasts survive route changes and any component may raise one. */
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const NO_TOASTS: Toast[] = [];

function setToasts(next: Toast[]): void {
	toasts = next;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

// More than a few stacked toasts only push the page out of the viewport; the oldest give way.
const MAX_TOASTS = 3;

function addToast(message: string, variant: ToastVariant): void {
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	// The same message again restarts one toast (new id = fresh timer) instead of stacking copies.
	const rest = toasts.filter((t) => !(t.message === message && t.variant === variant));
	setToasts([...rest, { id, message, variant }].slice(-MAX_TOASTS));
	haptic(variant === 'error' ? 'heavy' : variant === 'success' ? 'medium' : 'light');
}

function removeToast(id: string): void {
	setToasts(toasts.filter((t) => t.id !== id));
}

const toastApi = {
	success: (message: string) => addToast(message, 'success'),
	error: (message: string) => addToast(message, 'error'),
	info: (message: string) => addToast(message, 'info'),
};

/** Raising a toast does not subscribe the caller, so it never re-renders on toast changes. */
export function useToast() {
	return toastApi;
}

const variantIcons: Record<ToastVariant, typeof CheckCircle> = {
	success: CheckCircle,
	error: XCircle,
	info: Info,
};

function ToastItem({ toast }: { toast: Toast }) {
	const Icon = variantIcons[toast.variant];
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearTimer = useCallback(() => {
		if (timerRef.current !== null) clearTimeout(timerRef.current);
	}, []);

	const scheduleTimer = useCallback(() => {
		clearTimer();
		timerRef.current = setTimeout(() => removeToast(toast.id), TOAST_DURATION_MS);
	}, [clearTimer, toast.id]);

	useEffect(() => {
		scheduleTimer();
		return clearTimer;
	}, [scheduleTimer, clearTimer]);

	return (
		<Alert
			variant={toast.variant === 'error' ? 'destructive' : 'default'}
			role={toast.variant === 'error' ? 'alert' : 'status'}
			aria-live={toast.variant === 'error' ? undefined : 'polite'}
			className="flex flex-wrap items-center gap-x-3 gap-y-1"
			onMouseEnter={clearTimer}
			onMouseLeave={scheduleTimer}
			onFocus={clearTimer}
			onBlur={scheduleTimer}
		>
			<Icon className="shrink-0" aria-hidden="true" />
			<AlertDescription className="min-w-[10ch] flex-1 basis-[10ch] wrap-break-word">
				{toast.message}
			</AlertDescription>
			<Button
				type="button"
				onClick={() => removeToast(toast.id)}
				variant="ghost"
				size="icon"
				className="ml-auto size-11"
				aria-label="Benachrichtigung schließen"
			>
				<X aria-hidden="true" />
			</Button>
		</Alert>
	);
}

export function ToastContainer() {
	const current = useSyncExternalStore(
		subscribe,
		() => toasts,
		() => NO_TOASTS,
	);

	if (current.length === 0) return null;

	return (
		<div
			data-toast-stack
			className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--app-nav-height,5rem)+0.5rem+var(--thumb-action-space,0px))] z-50 mx-auto flex max-h-[60svh] w-full max-w-[var(--app-frame-width)] flex-col-reverse gap-2 overflow-y-auto overscroll-contain px-4"
			aria-label="Benachrichtigungen"
			// biome-ignore lint/a11y/useSemanticElements: role="region" names the fixed toast stack; <section> would add another landmark.
			role="region"
		>
			{/* Newest first in the DOM = lowest on screen, so a stack taller than the cap scrolls away from the newest. */}
			{[...current].reverse().map((toast) => (
				<div key={toast.id} className="pointer-events-auto">
					<ToastItem toast={toast} />
				</div>
			))}
		</div>
	);
}
