'use client';

import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';
import { useTranslations } from 'next-intl';

interface WgErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

/** Boundary for failures of the WG layout itself, so the way out leads to the site root. */
export default function WgError({ error, reset }: WgErrorProps) {
	const t = useTranslations('shell.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-code"
			title={t('somethingWrong')}
			body={t('wgBody')}
			homeHref="/"
			homeLabel={t('toHome')}
		/>
	);
}
