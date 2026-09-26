'use client';

import { useDocumentTitle } from '@/core/hooks/useDocumentTitle';
import { ImportWizard } from '@/features/expenses/components/import/ImportWizard';

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function ImportPage() {
	useDocumentTitle('Ausgaben importieren — ManaWG');
	return (
		<div data-finance-content className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
			<header className="flex flex-col gap-1">
				<h1 className="font-heading text-[26px] leading-8 font-semibold tracking-tight">
					Ausgaben importieren
				</h1>
				<p className="text-sm text-muted-foreground">
					Aus Splitwise oder Splid. Namen und Anteile vor dem Import prüfen.
				</p>
			</header>
			<ImportWizard />
		</div>
	);
}
