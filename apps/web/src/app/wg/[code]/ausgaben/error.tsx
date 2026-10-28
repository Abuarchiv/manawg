'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';
import { useTranslations } from 'next-intl';

interface AusgabenErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function AusgabenError({ error, reset }: AusgabenErrorProps) {
	const t = useTranslations('expenses.page');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-ausgaben"
			title={t('errorTitle')}
			body={t('errorBody')}
		/>
	);
}
