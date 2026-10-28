'use client';

import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
} from '@/components/ui/empty';
import { captureException } from '@/core/infra/capture-client';
import { isChunkLoadError, reloadOnStaleChunk } from '@/core/infra/stale-chunk';
import { SUPPORT_MAILTO } from '@/shared/lib/support-mailto';

export default function ErrorBoundary({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const mainRef = useRef<HTMLElement>(null);

	useEffect(() => {
		if (reloadOnStaleChunk(error)) return;
		captureException(error, { boundary: 'root' });
	}, [error]);

	// Focus was on the element that disappeared; without moving it, focus lands at the top of the page.
	useEffect(() => {
		mainRef.current?.focus();
	}, []);

	return (
		<main
			ref={mainRef}
			id="main"
			tabIndex={-1}
			className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col items-center justify-center bg-background px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] focus:outline-none"
		>
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<TriangleAlert aria-hidden />
					</EmptyMedia>
					<h1
						data-slot="empty-title"
						className="min-w-0 max-w-full text-base font-semibold [overflow-wrap:anywhere]"
					>
						Etwas ist schiefgelaufen
					</h1>
					<EmptyDescription>Bitte versuche es erneut.</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					{process.env.NODE_ENV === 'development' && (
						// biome-ignore lint/a11y/useSemanticElements: <pre> must stay a preformatted block; role="region" names its scroll area.
						<pre
							// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable error details must be focusable so keyboard users can scroll them.
							tabIndex={0}
							role="region"
							aria-label="Fehlerdetails"
							className="max-w-full overflow-auto rounded-lg border border-border bg-muted px-3 py-2 text-left text-xs text-foreground/75"
						>
							{error.message}
						</pre>
					)}
					<Button
						type="button"
						size="lg"
						onClick={() => (isChunkLoadError(error) ? window.location.reload() : reset())}
					>
						Erneut versuchen
					</Button>
					<Button variant="outline" size="lg" render={<Link href="/" />} nativeButton={false}>
						Zur Startseite
					</Button>
					<a href={SUPPORT_MAILTO} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
						Fehler per E-Mail melden
					</a>
				</EmptyContent>
			</Empty>
		</main>
	);
}
