import { Home, SearchX } from 'lucide-react';
import Link from 'next/link';

// craftsman-ignore: TS002 — Next.js App Router requires default export for not-found pages
export default function WgNotFound() {
	return (
		<div className="flex min-h-[calc(100svh-4.25rem)] items-center justify-center px-4 sm:px-6">
			<div className="w-full max-w-md rounded-2xl border border-dashed border-[var(--border-strong)] bg-gradient-to-b from-transparent to-[var(--surface)] p-10 text-center">
				<span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-inset ring-[var(--accent)]/15">
					<SearchX className="h-5 w-5" strokeWidth={1.75} aria-hidden />
				</span>

				<h2 className="text-xl font-semibold text-[var(--text-1)]">WG nicht gefunden</h2>
				<p className="mt-2 text-[14px] text-[var(--text-2)]">
					8-stelliger Code falsch oder WG wurde gelöscht.
				</p>

				<div className="mt-6 flex justify-center">
					<Link
						href="/neu"
						className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-5 text-[13px] font-medium text-[var(--text-2)] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:text-[var(--text-1)] hover:shadow-md"
					>
						<Home className="h-4 w-4" aria-hidden />
						Neue WG erstellen oder beitreten
					</Link>
				</div>
			</div>
		</div>
	);
}
