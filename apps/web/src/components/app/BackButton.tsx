'use client';

import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export function BackButton({
	onClick,
	disabled = false,
}: { onClick: () => void; disabled?: boolean }) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="default"
			onClick={onClick}
			disabled={disabled}
			aria-label="Zurück"
		>
			<ArrowLeft data-icon="inline-start" aria-hidden /> Zurück
		</Button>
	);
}
