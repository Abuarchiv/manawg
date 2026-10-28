'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

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
