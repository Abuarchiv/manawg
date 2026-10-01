'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface PutzenErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function PutzenError({ error, reset }: PutzenErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-putzen"
			title="Putzplan konnte gerade nicht geladen werden"
			body="Im Putzplan ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
