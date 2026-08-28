// craftsman-ignore: TS002 — Next.js App Router requires default export for error boundaries
'use client';

import { captureException } from '@/lib/observability';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

interface Props {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ImportError({ error, reset }: Props) {
	useEffect(() => {
		captureException(error, { boundary: 'wg-import' });
	}, [error]);
	return (
		<div className="mx-auto max-w-2xl px-4 py-8">
			<div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-6">
				<div className="mb-3 flex items-center gap-2 text-[var(--danger)]">
					<AlertTriangle className="h-5 w-5" aria-hidden />
					<h1 className="text-[16px] font-semibold">
						Import-Assistent konnte nicht geladen werden
					</h1>
				</div>
				<p className="text-[13px] text-[var(--text-2)]">
					{process.env.NODE_ENV === 'development' ? error.message : 'Bitte versuche es erneut.'}
				</p>
				<div className="mt-4 flex gap-2">
					<button
						type="button"
						onClick={reset}
						className="h-11 rounded-md bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						Erneut versuchen
					</button>
					<Link
						href="../einstellungen#daten"
						className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-4 text-[13px] text-[var(--text-1)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						Zurück zu Einstellungen
					</Link>
				</div>
			</div>
		</div>
	);
}
