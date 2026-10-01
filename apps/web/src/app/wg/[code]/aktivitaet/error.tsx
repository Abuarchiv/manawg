'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface AktivitaetErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function AktivitaetError({ error, reset }: AktivitaetErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-aktivitaet"
			title="Aktivität konnte gerade nicht geladen werden"
			body="Im Aktivitäts-Feed ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
