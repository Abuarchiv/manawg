'use client';

import { useWg } from '@/components/wg/WgContextProvider';
import { ImportWizard } from '@/features/expenses/components/import/ImportWizard';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function ImportPage() {
	const { wg } = useWg();
	const wgBaseHref = `/wg/${encodeURIComponent(wg.shareCode)}`;
	return (
		<div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
			<header className="mb-6 flex items-center gap-3">
				<Link
					href={`${wgBaseHref}/einstellungen#daten`}
					aria-label="Zurück zu Einstellungen"
					className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					<ArrowLeft className="h-4 w-4" aria-hidden />
				</Link>
				<h1 className="min-w-0 truncate text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
					Ausgaben importieren
				</h1>
			</header>
			<p className="mb-6 text-[13px] text-[var(--text-3)]">
				Bestehende Ausgaben aus Splitwise oder Splid übernehmen: CSV einfügen oder Screenshot
				hochladen. ManaWG ordnet Namen automatisch zu — du bestätigst.
			</p>
			<ImportWizard />
		</div>
	);
}
