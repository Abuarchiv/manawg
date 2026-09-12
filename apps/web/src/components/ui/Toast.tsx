'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { haptic } from '@/shared/lib/haptics';
import { CheckCircle, Info, X, XCircle } from 'lucide-react';
import { create } from 'zustand';

type ToastVariant = 'success' | 'error' | 'info';

interface Toast {
	id: string;
	message: string;
	variant: ToastVariant;
}

interface ToastStore {
	toasts: Toast[];
	addToast: (message: string, variant: ToastVariant) => void;
	removeToast: (id: string) => void;
}

const useToastStore = create<ToastStore>((set) => ({
	toasts: [],
	addToast: (message, variant) => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
		haptic(variant === 'error' ? 'heavy' : variant === 'success' ? 'medium' : 'light');
		setTimeout(() => {
			set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
		}, 4000);
	},
	removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

// Öffentlicher Hook
export function useToast() {
	const { addToast } = useToastStore();
	return {
		success: (message: string) => addToast(message, 'success'),
		error: (message: string) => addToast(message, 'error'),
		info: (message: string) => addToast(message, 'info'),
	};
}

const variantIcons: Record<ToastVariant, typeof CheckCircle> = {
	success: CheckCircle,
	error: XCircle,
	info: Info,
};

function ToastItem({ toast }: { toast: Toast }) {
	const { removeToast } = useToastStore();
	const Icon = variantIcons[toast.variant];

	return (
		<Alert
			variant={toast.variant === 'error' ? 'destructive' : 'default'}
			role={toast.variant === 'error' ? 'alert' : 'status'}
			aria-live={toast.variant === 'error' ? undefined : 'polite'}
			className="flex items-center gap-3"
		>
			<Icon className="shrink-0" aria-hidden="true" />
			<AlertDescription className="min-w-0 flex-1 wrap-anywhere">{toast.message}</AlertDescription>
			<Button
				type="button"
				onClick={() => removeToast(toast.id)}
				variant="ghost"
				size="icon"
				className="size-11"
				aria-label="Benachrichtigung schließen"
			>
				<X aria-hidden="true" />
			</Button>
		</Alert>
	);
}

export function ToastContainer() {
	const { toasts } = useToastStore();

	if (toasts.length === 0) return null;

	return (
		<div
			className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex w-full max-w-[var(--app-frame-width)] flex-col gap-2 px-4"
			aria-label="Benachrichtigungen"
			aria-live="polite"
			aria-atomic="true"
		>
			{toasts.map((toast) => (
				<div key={toast.id} className="pointer-events-auto">
					<ToastItem toast={toast} />
				</div>
			))}
		</div>
	);
}
