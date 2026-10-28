'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface RemindersErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function RemindersError({ error, reset }: RemindersErrorProps) {
	const t = useTranslations('expenses-debts.page.boundary');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-reminders"
			title={t('title')}
			body={t('body')}
		/>
	);
}
