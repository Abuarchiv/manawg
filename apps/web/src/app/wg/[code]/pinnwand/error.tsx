'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';
import { useTranslations } from 'next-intl';

interface PinnwandErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function PinnwandError({ error, reset }: PinnwandErrorProps) {
	const t = useTranslations('pinnwand.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-pinnwand"
			title={t('title')}
			body={t('body')}
		/>
	);
}
