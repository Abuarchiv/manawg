'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';

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
		<output
			aria-live="polite"
			aria-busy={state === 'pending'}
			className="block rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
		>
			{state === 'pending' && (
				<div className="flex items-center gap-2 text-[13px] text-[var(--text-2)]">
					<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
					Import läuft...
				</div>
			)}
			{state === 'done' && (
				<div className="flex items-start gap-2">
					<CheckCircle2 className="mt-0.5 h-5 w-5 text-[var(--success-fg)]" aria-hidden />
					<div>
						<div className="text-[14px] font-medium text-[var(--text-1)]">Import abgeschlossen</div>
						<div className="text-[12.5px] text-[var(--text-3)]">
							{inserted} importiert · {skipped} übersprungen · {errors} Fehler
						</div>
					</div>
				</div>
			)}
			{state === 'error' && (
				<p className="text-[13px] text-[var(--danger)]" role="alert">
					{message ?? 'Import fehlgeschlagen.'}
				</p>
			)}
		</output>
	);
}
