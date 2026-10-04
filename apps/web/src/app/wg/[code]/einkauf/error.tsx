'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface EinkaufErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function EinkaufError({ error, reset }: EinkaufErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-einkauf"
			title="Einkäufe konnten gerade nicht geladen werden"
			body="In der Einkaufsliste ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
