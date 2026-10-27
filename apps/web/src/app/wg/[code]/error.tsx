'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface WgErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

/** Boundary for failures of the WG layout itself, so the way out leads to the site root. */
export default function WgError({ error, reset }: WgErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-code"
			title="Etwas ist schiefgelaufen"
			body="Ein Fehler ist aufgetreten. Bitte versuche es erneut oder gehe zur Startseite."
			homeHref="/"
			homeLabel="Zur Startseite"
		/>
	);
}
