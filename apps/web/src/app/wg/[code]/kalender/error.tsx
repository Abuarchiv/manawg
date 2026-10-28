'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface KalenderErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function KalenderError({ error, reset }: KalenderErrorProps) {
	const t = useTranslations('events.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-kalender"
			title={t('title')}
			body={t('body')}
		/>
	);
}
