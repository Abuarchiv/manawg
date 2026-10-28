'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface SuppliesErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function SuppliesError({ error, reset }: SuppliesErrorProps) {
	const t = useTranslations('inventory.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-supplies"
			title={t('title')}
			body={t('body')}
		/>
	);
}
