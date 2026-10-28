'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface PutzenErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function PutzenError({ error, reset }: PutzenErrorProps) {
	const t = useTranslations('chores.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-putzen"
			title={t('title')}
			body={t('body')}
		/>
	);
}
