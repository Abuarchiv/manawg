'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface EinstellungenErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function EinstellungenError({ error, reset }: EinstellungenErrorProps) {
	const t = useTranslations('settings.error');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-einstellungen"
			title={t('title')}
			body={t('body')}
		/>
	);
}
