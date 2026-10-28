'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface AbrechnungErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function AbrechnungError({ error, reset }: AbrechnungErrorProps) {
	const t = useTranslations('statement');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-abrechnung"
			title={t('page.boundary.title')}
			body={t('page.boundary.body')}
		/>
	);
}
