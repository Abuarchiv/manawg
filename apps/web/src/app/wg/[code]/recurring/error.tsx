'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface RecurringErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function RecurringError({ error, reset }: RecurringErrorProps) {
	const t = useTranslations('expenses-recurring');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-recurring"
			title={t('page.boundary.title')}
			body={t('page.boundary.body')}
		/>
	);
}
