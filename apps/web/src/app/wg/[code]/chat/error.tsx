'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface ChatErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ChatError({ error, reset }: ChatErrorProps) {
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-chat"
			title="Chat konnte gerade nicht geladen werden"
			body="Im Chat ist ein Fehler aufgetreten. Bitte versuche es erneut oder kehre zur WG-Übersicht zurück."
		/>
	);
}
