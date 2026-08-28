// craftsman-ignore: TS002 — Next.js App Router requires default export for error boundaries
'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface KalenderErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function KalenderError({ error, reset }: KalenderErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-kalender"
			title="Kalender konnte gerade nicht geladen werden"
			body="Beim Laden der Termine ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
