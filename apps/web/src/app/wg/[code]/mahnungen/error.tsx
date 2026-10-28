'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';
import { useTranslations } from 'next-intl';

interface ErinnerungenErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ErinnerungenError({ error, reset }: ErinnerungenErrorProps) {
	const t = useTranslations('expenses-debts.page.boundary');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-mahnungen"
			title={t('title')}
			body={t('body')}
		/>
	);
}
