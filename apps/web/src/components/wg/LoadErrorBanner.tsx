'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { RotateCw } from 'lucide-react';

interface LoadErrorBannerProps {
	message: string;
	onRetry: () => void;
	/** Marks the button aria-disabled and spins the icon while a reload is in flight. */
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
		<Alert variant="destructive" className="flex flex-wrap items-center gap-x-3 gap-y-2">
			<AlertDescription className="min-w-0 flex-1 basis-48 text-current">
				{message}
			</AlertDescription>
			<Button
				variant="outline"
				size="sm"
				type="button"
				// aria-disabled instead of disabled: a disabled button drops keyboard focus mid-retry.
				onClick={busy ? undefined : onRetry}
				aria-disabled={busy}
				className="max-w-full shrink-0 whitespace-normal aria-disabled:pointer-events-none aria-disabled:opacity-50"
			>
				{busy ? <Spinner aria-hidden /> : <RotateCw data-icon="inline-start" aria-hidden />}
				{busy ? 'Lädt…' : retryLabel}
			</Button>
		</Alert>
	);
}
