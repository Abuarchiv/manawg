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

export default function GlobalError({
	error,
	reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
	useEffect(() => {
		captureException(error, { boundary: 'global' });
	}, [error]);

	return (
		<html lang="de">
			<body className="min-h-[100dvh] bg-background text-foreground antialiased">
				<main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-4 pb-[env(safe-area-inset-bottom)]">
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<TriangleAlert aria-hidden />
							</EmptyMedia>
							<EmptyTitle>Etwas ist schiefgelaufen</EmptyTitle>
							<EmptyDescription>Bitte lade die Seite neu.</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button type="button" size="lg" onClick={() => reset()} className="min-h-11">
								Erneut versuchen
							</Button>
						</EmptyContent>
					</Empty>
				</main>
			</body>
		</html>
	);
}
