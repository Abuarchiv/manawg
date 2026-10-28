'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface AbosErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function AbosError({ error, reset }: AbosErrorProps) {
	const t = useTranslations('expenses-abos');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-abos"
			title={t('page.boundary.title')}
			body={t('page.boundary.body')}
		/>
	);
}
