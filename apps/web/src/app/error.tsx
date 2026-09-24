// craftsman-ignore: TS002 — Next.js App Router requires default export for error boundaries
'use client';

import { Button } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { captureException } from '@/core/infra/observability';
import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';

export default function ErrorBoundary({
	error,
	reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
	useEffect(() => {
		captureException(error, { boundary: 'root' });
	}, [error]);

	return (
		<div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center bg-background px-4 pb-[env(safe-area-inset-bottom)]">
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<TriangleAlert aria-hidden />
					</EmptyMedia>
					<EmptyTitle>Etwas ist schiefgelaufen</EmptyTitle>
					<EmptyDescription>Bitte versuche es erneut.</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					{process.env.NODE_ENV === 'development' && (
						<pre
							// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable error details must be focusable so keyboard users can scroll them.
							tabIndex={0}
							// biome-ignore lint/a11y/useSemanticElements: <pre> must stay a preformatted block; role="region" names its scroll area.
							role="region"
							aria-label="Fehlerdetails"
							className="max-w-full overflow-auto rounded-lg border border-border bg-muted px-3 py-2 text-left text-xs text-foreground/75"
						>
							{error.message}
						</pre>
					)}
					<Button type="button" size="lg" onClick={() => reset()}>
						Erneut versuchen
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}
