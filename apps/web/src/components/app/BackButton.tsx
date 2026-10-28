'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function BackButton({
	onClick,
	disabled = false,
}: {
	onClick: () => void;
	disabled?: boolean;
}) {
	const t = useTranslations('shell');
	return (
		<Button
			type="button"
			variant="ghost"
			size="default"
			onClick={onClick}
			disabled={disabled}
			aria-label={t('back')}
		>
			<ArrowLeft data-icon="inline-start" aria-hidden /> {t('back')}
		</Button>
	);
}
