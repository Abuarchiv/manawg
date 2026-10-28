'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface ShoppingErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ShoppingError({ error, reset }: ShoppingErrorProps) {
	const t = useTranslations('shopping.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-shopping"
			title={t('title')}
			body={t('body')}
		/>
	);
}
