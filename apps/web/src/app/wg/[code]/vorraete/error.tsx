'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface VorraeteErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function VorraeteError({ error, reset }: VorraeteErrorProps) {
	const t = useTranslations('inventory.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-vorraete"
			title={t('title')}
			body={t('body')}
		/>
	);
}
