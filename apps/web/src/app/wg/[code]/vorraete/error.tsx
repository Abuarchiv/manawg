// craftsman-ignore: TS002 — Next.js App Router requires default export for error boundaries
'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface VorraeteErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function VorraeteError({ error, reset }: VorraeteErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-vorraete"
			title="Vorräte konnten gerade nicht geladen werden"
			body="In den Vorräten ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
