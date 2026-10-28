'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface StatementErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function StatementError({ error, reset }: StatementErrorProps) {
	const t = useTranslations('statement');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-statement"
			title={t('page.boundary.title')}
			body={t('page.boundary.body')}
		/>
	);
}
