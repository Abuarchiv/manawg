'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface ImportErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ImportError({ error, reset }: ImportErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-import"
			title="Import-Assistent konnte nicht geladen werden"
			body="Beim Laden des Import-Assistenten ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
