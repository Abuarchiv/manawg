'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface AktivitaetErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function AktivitaetError({ error, reset }: AktivitaetErrorProps) {
	const t = useTranslations('activity.error');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-aktivitaet"
			title={t('title')}
			body={t('body')}
		/>
	);
}
