'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface PinboardErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function PinboardError({ error, reset }: PinboardErrorProps) {
	const t = useTranslations('pinboard.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-pinboard"
			title={t('title')}
			body={t('body')}
		/>
	);
}
