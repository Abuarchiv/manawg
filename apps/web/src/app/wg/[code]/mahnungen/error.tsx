// craftsman-ignore: TS002 — Next.js App Router requires default export for error boundaries
'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface MahnungenErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function MahnungenError({ error, reset }: MahnungenErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-mahnungen"
			title="Mahnungen konnten gerade nicht geladen werden"
			body="Auf der Mahnungs-Seite ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
