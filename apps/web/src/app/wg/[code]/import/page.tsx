'use client';

import { ImportWizard } from '@/features/expenses/components/import/ImportWizard';

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function ImportPage() {
	return (
		<div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-5">
			<header className="flex flex-col gap-1">
				<h1 className="text-xl font-semibold">Ausgaben importieren</h1>
				<p className="text-sm text-muted-foreground">
					Aus Splitwise oder Splid. Namen und Anteile vor dem Import prüfen.
				</p>
			</header>
			<ImportWizard />
		</div>
	);
}
