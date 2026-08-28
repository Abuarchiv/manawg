// craftsman-ignore: TS002 — Next.js App Router requires default export for error boundaries
'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface AusgabenErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function AusgabenError({ error, reset }: AusgabenErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-ausgaben"
			title="Ausgaben konnten gerade nicht geladen werden"
			body="In der Ausgaben-Übersicht ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
