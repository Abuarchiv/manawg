'use client';

import { useTranslations } from 'next-intl';
import { WgRouteErrorBoundary } from '@/components/wg/WgRouteErrorBoundary';

interface ChatErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ChatError({ error, reset }: ChatErrorProps) {
	const t = useTranslations('chat.errorPage');
	return (
		<WgRouteErrorBoundary
			error={error}
			reset={reset}
			boundary="wg-chat"
			title={t('title')}
			body={t('body')}
		/>
	);
}
