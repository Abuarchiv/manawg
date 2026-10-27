'use client';

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
import { THEME_BOOTSTRAP_SCRIPT, applyStoredTheme } from '@/shared/lib/theme';
import '@/shared/globals.css';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useLayoutEffect } from 'react';

export default function GlobalError({
	error,
	reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
	// The head script only runs on a server render; a client-rendered error page needs this
	// before paint so dark devices do not flash white.
	useLayoutEffect(applyStoredTheme, []);
	useEffect(() => {
		if (reloadOnStaleChunk(error)) return;
		captureException(error, { boundary: 'global' });
	}, [error]);

	return (
		<html lang="de" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static constant, no dynamic data */}
				<script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
			</head>
			<body className="min-h-[100dvh] bg-background text-foreground antialiased">
				<main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
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
							<EmptyDescription>Bitte lade die Seite neu.</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button
								type="button"
								size="lg"
								onClick={() => (isChunkLoadError(error) ? window.location.reload() : reset())}
							>
								Erneut versuchen
							</Button>
							{/* No next/link: this error sits above the root layout, so only a hard page load helps. */}
							<a href="/" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
								Zur Startseite
							</a>
							<a
								href={SUPPORT_MAILTO}
								className={buttonVariants({ variant: 'outline', size: 'lg' })}
							>
								Fehler per E-Mail melden
							</a>
						</EmptyContent>
					</Empty>
				</main>
			</body>
		</html>
	);
}
