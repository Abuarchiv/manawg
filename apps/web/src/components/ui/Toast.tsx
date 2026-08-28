'use client';
import { cn } from '@/core/utils/utils';
import { haptic } from '@manawg/shared/lib/haptics';
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

const variantConfig: Record<
	ToastVariant,
	{ icon: typeof CheckCircle; iconClass: string; barClass: string }
> = {
	success: {
		icon: CheckCircle,
		iconClass: 'text-[var(--success)]',
		barClass: 'bg-[var(--success)]',
	},
	error: {
		icon: XCircle,
		iconClass: 'text-[var(--danger)]',
		barClass: 'bg-[var(--danger)]',
	},
	info: {
		icon: Info,
		iconClass: 'text-[var(--text-2)]',
		barClass: 'bg-[var(--text-2)]',
	},
};

function ToastItem({ toast }: { toast: Toast }) {
	const { removeToast } = useToastStore();
	const { icon: Icon, iconClass, barClass } = variantConfig[toast.variant];

	return (
		<div
			role={toast.variant === 'error' ? 'alert' : 'status'}
			aria-live={toast.variant === 'error' ? undefined : 'polite'}
			className="relative flex items-start gap-3 rounded-xl glass border border-[var(--border)] px-4 py-3 overflow-hidden w-[90vw] max-w-sm sm:w-auto"
		>
			{/* Farbbalken links */}
			<div className={cn('absolute left-0 top-0 bottom-0 w-1', barClass)} />

			<Icon className={cn('w-5 h-5 mt-0.5 shrink-0 ml-1', iconClass)} aria-hidden="true" />

			<p className="flex-1 text-sm text-[var(--text-1)] leading-snug">{toast.message}</p>

			<button
				type="button"
				onClick={() => removeToast(toast.id)}
				className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				aria-label="Benachrichtigung schließen"
			>
				<X className="w-4 h-4" aria-hidden="true" />
			</button>

			{/* Auto-dismiss Fortschrittsbalken */}
			<div
				className={cn('absolute bottom-0 left-0 h-0.5', barClass, 'animate-toast-progress')}
				style={{ animationDuration: '4000ms' }}
			/>
		</div>
	);
}

export function ToastContainer() {
	const { toasts } = useToastStore();

	if (toasts.length === 0) return null;

	return (
		<div
			className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none sm:bottom-6 sm:items-end sm:right-6 sm:left-auto"
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
