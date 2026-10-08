'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface AbrechnungErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function AbrechnungError({ error, reset }: AbrechnungErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-abrechnung"
			title="Die Abrechnung konnte gerade nicht geladen werden"
			body="Auf der Abrechnungs-Seite ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
