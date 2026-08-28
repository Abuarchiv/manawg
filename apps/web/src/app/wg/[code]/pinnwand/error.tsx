// craftsman-ignore: TS002 — Next.js App Router requires default export for error boundaries
'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface PinnwandErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function PinnwandError({ error, reset }: PinnwandErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-pinnwand"
			title="Pinnwand konnte gerade nicht geladen werden"
			body="Auf der Pinnwand ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
