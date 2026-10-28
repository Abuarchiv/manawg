'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';
import { useTranslations } from 'next-intl';

interface EinkaufErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function EinkaufError({ error, reset }: EinkaufErrorProps) {
	const t = useTranslations('shopping.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-einkauf"
			title={t('title')}
			body={t('body')}
		/>
	);
}
