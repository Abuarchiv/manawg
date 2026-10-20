'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface EinstellungenErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function EinstellungenError({ error, reset }: EinstellungenErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-einstellungen"
			title="Einstellungen konnten gerade nicht geladen werden"
			body="In den Einstellungen ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
