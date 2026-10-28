'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface SettingsErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function SettingsError({ error, reset }: SettingsErrorProps) {
	const t = useTranslations('settings.error');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-settings"
			title={t('title')}
			body={t('body')}
		/>
	);
}
