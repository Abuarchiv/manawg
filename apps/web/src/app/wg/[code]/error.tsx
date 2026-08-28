// craftsman-ignore: TS002 — Next.js App Router requires default export for error boundaries
'use client';

import { captureException } from '@/core/infra/observability';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

interface WgErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function WgError({ error, reset }: WgErrorProps) {
	useEffect(() => {
		captureException(error, { boundary: 'wg-code' });
	}, [error]);

	return (
		<div className="flex min-h-[calc(100svh-4.25rem)] items-center justify-center px-4 sm:px-6">
			<div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-sm">
				<span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--danger)]/10 text-[var(--danger)] ring-1 ring-inset ring-[var(--danger)]/20">
					<AlertTriangle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
				</span>

				<h2 className="text-xl font-semibold text-[var(--text-1)]">Etwas ist schiefgelaufen</h2>
				<p className="mt-2 text-[14px] text-[var(--text-2)]">
					Ein Fehler ist aufgetreten. Bitte versuche es erneut oder gehe zur Startseite.
				</p>

				{process.env.NODE_ENV === 'development' && (
					<pre className="mt-4 overflow-auto rounded-xl bg-[var(--surface-strong)] px-3 py-2 text-left text-[12px] text-[var(--text-3)]">
						{error.message}
					</pre>
				)}

				<div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
					<button
						type="button"
						onClick={reset}
						className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[var(--accent-bright)] to-[var(--accent)] px-5 text-[13px] font-medium text-[var(--accent-fg)] shadow-sm shadow-[var(--accent)]/20 ring-1 ring-inset ring-white/10 transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-[var(--accent)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 active:translate-y-0 sm:w-auto"
					>
						Erneut versuchen
					</button>
					<Link
						href="/"
						className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-5 text-[13px] font-medium text-[var(--text-2)] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:text-[var(--text-1)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 sm:w-auto"
					>
						Zur Startseite
					</Link>
				</div>
			</div>
		</div>
	);
}
