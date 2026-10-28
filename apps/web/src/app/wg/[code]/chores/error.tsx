'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface ChoresErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ChoresError({ error, reset }: ChoresErrorProps) {
	const t = useTranslations('chores.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-chores"
			title={t('title')}
			body={t('body')}
		/>
	);
}
