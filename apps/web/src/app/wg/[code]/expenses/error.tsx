'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface ExpensesErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ExpensesError({ error, reset }: ExpensesErrorProps) {
	const t = useTranslations('expenses.page');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-expenses"
			title={t('errorTitle')}
			body={t('errorBody')}
		/>
	);
}
