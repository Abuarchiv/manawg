'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';
import { useTranslations } from 'next-intl';

interface ImportErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ImportError({ error, reset }: ImportErrorProps) {
	const t = useTranslations('expenses-import.boundary');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-import"
			title={t('title')}
			body={t('body')}
		/>
	);
}
