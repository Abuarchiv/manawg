'use client';

import { buttonVariants } from '@/components/ui/button';
import { SESSION_EXPIRED_EVENT } from '@/core/infra/api-client';
import { cn } from '@/shared/lib/cn';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Any request answered with "session expired" lands here, so every screen shows the same
 * explanation and one way back in, which returns to the page the visitor was on.
 */
export function SessionExpiredBanner() {
	const [returnTo, setReturnTo] = useState<string | null>(null);

	useEffect(() => {
		function onExpired(): void {
			setReturnTo(`${window.location.pathname}${window.location.search}`);
		}
		window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
		return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
	}, []);

	if (!returnTo) return null;
	return (
		<div
			role="alert"
			className="bg-muted text-foreground border-border sticky top-0 z-20 border-b px-4 py-2 text-meta font-medium"
		>
			<div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<div className="flex min-w-0 flex-[1_1_8rem] items-center gap-2">
					<AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
					<span>Deine Sitzung ist abgelaufen. Melde dich neu an, um weiterzumachen.</span>
				</div>
				<Link
					href={`/neu?next=${encodeURIComponent(returnTo)}`}
					className={cn(buttonVariants({ size: 'sm' }), 'min-h-11')}
				>
					Neu anmelden
				</Link>
			</div>
		</div>
	);
}
