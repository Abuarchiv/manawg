'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { CheckCircle2 } from 'lucide-react';

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
							? 'Import mit Fehlern abgeschlossen'
							: `${inserted} importiert`}
			</AlertTitle>
			<AlertDescription>
				{state === 'pending' ? (
					<Progress value={null} aria-label="Import läuft" className="mt-3" />
				) : state === 'error' ? (
					(message ?? 'Bitte erneut versuchen.')
				) : (
					`${skipped} übersprungen · ${errors} Fehler`
				)}
			</AlertDescription>
		</Alert>
	);
}
