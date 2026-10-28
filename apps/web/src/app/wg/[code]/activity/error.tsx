'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface ActivityErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ActivityError({ error, reset }: ActivityErrorProps) {
	const t = useTranslations('activity.error');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-activity"
			title={t('title')}
			body={t('body')}
		/>
	);
}
