'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface AbosErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function AbosError({ error, reset }: AbosErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-abos"
			title="Fixkosten konnten gerade nicht geladen werden"
			body="Auf der Fixkosten-Seite ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
