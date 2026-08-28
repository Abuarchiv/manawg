// craftsman-ignore: TS002 — wrapper consumed by Next.js App Router error.tsx default exports
'use client';

import { captureException } from '@/core/infra/observability';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';

interface WgRouteErrorBoundaryProps {
	error: Error & { digest?: string };
	reset: () => void;
	/** Identifies the failing route in the error log — e.g. `wg-chat`, `wg-vorraete`. */
	boundary: string;
	/** Heading shown to the user. */
	title: string;
	/** Supporting copy under the heading. */
	body: string;
}

/**
 * Shared error boundary used by every `/wg/[code]/<segment>/error.tsx`.
 *
 * Next.js App Router requires each segment to ship its own default-export
 * client `error.tsx`; this component lets them shrink to a small wrapper
 * that just passes the per-route copy + boundary name.
 */
export function WgRouteErrorBoundary({
	error,
	reset,
	boundary,
	title,
	body,
}: WgRouteErrorBoundaryProps) {
	const params = useParams<{ code: string }>();
	const code = params?.code ?? '';

	useEffect(() => {
		captureException(error, { boundary });
	}, [error, boundary]);

	return (
		<div className="flex min-h-[calc(100svh-4.25rem)] items-center justify-center px-4 sm:px-6">
			<div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-sm">
				<span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--danger)]/10 text-[var(--danger)] ring-1 ring-inset ring-[var(--danger)]/20">
					<AlertTriangle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
				</span>

				<h2 className="text-xl font-semibold text-[var(--text-1)]">{title}</h2>
				<p className="mt-2 text-[14px] text-[var(--text-2)]">{body}</p>

				{process.env.NODE_ENV === 'development' && (
					<pre className="mt-4 overflow-auto rounded-xl bg-[var(--surface-strong)] px-3 py-2 text-left text-[12px] text-[var(--text-3)]">
						{error.message}
					</pre>
				)}

				<div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
					<button
						type="button"
						onClick={reset}
						className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[var(--accent-bright)] to-[var(--accent)] px-5 text-[13px] font-medium text-[var(--accent-fg)] shadow-sm shadow-[var(--accent)]/20 ring-1 ring-inset ring-white/10 transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-[var(--accent)]/30 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 sm:w-auto"
					>
						Erneut versuchen
					</button>
					<Link
						href={`/wg/${code}`}
						className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-5 text-[13px] font-medium text-[var(--text-2)] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:text-[var(--text-1)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 sm:w-auto"
					>
						Zur Übersicht
					</Link>
				</div>
			</div>
		</div>
	);
}
