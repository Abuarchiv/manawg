'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface CalendarErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function CalendarError({ error, reset }: CalendarErrorProps) {
	const t = useTranslations('events.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-calendar"
			title={t('title')}
			body={t('body')}
		/>
	);
}
