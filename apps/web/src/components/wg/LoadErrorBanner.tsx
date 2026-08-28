'use client';

import { ALERT_DANGER_ROW } from '@/components/ui/styles';
import { RotateCw } from 'lucide-react';

interface LoadErrorBannerProps {
	message: string;
	onRetry: () => void;
	/** Disables the button and spins the icon while a reload is in flight. */
	busy: boolean;
	/** e.g. "Liste erneut laden". */
	retryLabel: string;
}

/**
 * "Loading failed, try again" — the banner seven pages showed above their
 * content.
 *
 * The seven copies had drifted: only the activity page gave the retry button a
 * focus ring and the danger text colour, search dropped the icon and the gap,
 * and two different refresh icons were in use. This keeps the most complete
 * version, so every page gets the focus ring.
 */
export function LoadErrorBanner({ message, onRetry, busy, retryLabel }: LoadErrorBannerProps) {
	return (
		<div role="alert" className={ALERT_DANGER_ROW}>
			<span>{message}</span>
			<button
				type="button"
				onClick={onRetry}
				disabled={busy}
				className="inline-flex h-11 items-center gap-1.5 rounded-md border border-[var(--danger)]/30 px-3 text-[12px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
			>
				<RotateCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
				{busy ? 'Lädt...' : retryLabel}
			</button>
		</div>
	);
}
