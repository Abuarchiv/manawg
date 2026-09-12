'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';
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
		<Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">
			<AlertDescription className="flex-1 text-current">{message}</AlertDescription>
			<Button
				variant="outline"
				size="lg"
				type="button"
				onClick={onRetry}
				disabled={busy}
				className="min-h-11"
			>
				<RotateCw data-icon="inline-start" className={cn(busy && 'animate-spin')} aria-hidden />
				{busy ? 'Lädt...' : retryLabel}
			</Button>
		</Alert>
	);
}
