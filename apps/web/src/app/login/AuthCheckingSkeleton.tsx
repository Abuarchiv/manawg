'use client';

import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';

/** Placeholder while the session check runs, shaped like the content that replaces it. */
export function AuthCheckingSkeleton({ checkingSession }: { checkingSession: boolean }) {
	const t = useTranslations('entry.start');
	return (
		<output aria-live="polite" aria-label={t('authChecking')} className="flex flex-col gap-4">
			{checkingSession ? (
				// Shaped like the two choose buttons that replace it.
				<div className="flex flex-col gap-2">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
				</div>
			) : (
				// Shaped like the sign-in form (Google, separator, two fields, link, two buttons).
				<>
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-5 w-full" />
					<Skeleton className="h-[4.5rem] w-full" />
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-[4.5rem] w-full" />
				</>
			)}
			<span className="sr-only">{t('authChecking')}</span>
		</output>
	);
}
