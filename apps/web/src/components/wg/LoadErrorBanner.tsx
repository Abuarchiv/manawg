'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { type Message, useMessage } from '@/shared/i18n/message';
import { RotateCw } from 'lucide-react';

interface LoadErrorBannerProps {
	message: string | Message;
	onRetry: () => void;
	/** Marks the button aria-disabled and spins the icon while a reload is in flight. */
	busy: boolean;
	/** e.g. "Liste erneut laden". */
	retryLabel: string | Message;
}

/**
 * Inline "loading failed" alert with a retry button. While a reload is in
 * flight the button stays focusable (aria-disabled) so keyboard focus is not lost.
 */
export function LoadErrorBanner({ message, onRetry, busy, retryLabel }: LoadErrorBannerProps) {
	const t = useMessage();
	const text = (value: string | Message) => (typeof value === 'string' ? value : t(value));
	return (
		<Alert variant="destructive" className="flex flex-wrap items-center gap-x-3 gap-y-2">
			<AlertDescription className="min-w-0 flex-1 basis-48 text-current">
				{text(message)}
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
				{busy ? t({ key: 'common.loading' }) : text(retryLabel)}
			</Button>
		</Alert>
	);
}
