'use client';

import { CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/shared/lib/cn';

/** Indeterminate bar with a stronger track; the indicator fills the track and pulses. */
export function ImportRunningBar({
	className,
	decorative = false,
}: {
	className?: string;
	decorative?: boolean;
}) {
	return (
		<Progress
			value={null}
			aria-label="Import läuft"
			aria-hidden={decorative || undefined}
			className={cn(
				'[&_[data-slot=progress-track]]:bg-primary/20 [&_[data-slot=progress-indicator]]:w-full motion-safe:[&_[data-slot=progress-indicator]]:animate-pulse',
				className,
			)}
		/>
	);
}

interface Props {
	state: 'idle' | 'pending' | 'done' | 'error';
	inserted?: number;
	skipped?: number;
	errors?: number;
	message?: string | null;
}

export function ImportProgress({ state, inserted = 0, skipped = 0, errors = 0, message }: Props) {
	if (state === 'idle') return null;
	return (
		<Alert
			role={state === 'error' ? 'alert' : 'status'}
			variant={state === 'error' || errors > 0 ? 'destructive' : 'default'}
			aria-busy={state === 'pending'}
		>
			{state === 'pending' ? (
				<Spinner />
			) : state === 'done' && errors === 0 ? (
				<CheckCircle2 />
			) : null}
			<AlertTitle>
				{state === 'pending'
					? 'Import läuft…'
					: state === 'error'
						? 'Import fehlgeschlagen'
						: errors > 0
							? 'Mit Fehlern'
							: 'Ohne Fehler'}
			</AlertTitle>
			<AlertDescription>
				{state === 'pending' ? (
					<ImportRunningBar className="mt-3" />
				) : state === 'error' ? (
					(message ?? 'Bitte erneut versuchen.')
				) : (
					`${inserted} importiert · ${skipped} übersprungen · ${errors} Fehler`
				)}
			</AlertDescription>
		</Alert>
	);
}
