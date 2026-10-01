'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface ErinnerungenErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ErinnerungenError({ error, reset }: ErinnerungenErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-mahnungen"
			title="Erinnerungen konnten gerade nicht geladen werden"
			body="Auf der Erinnerungs-Seite ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
