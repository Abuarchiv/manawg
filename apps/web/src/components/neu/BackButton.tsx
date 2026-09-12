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
			className="min-h-[44px] min-w-[44px]"
		>
			<ArrowLeft data-icon="inline-start" aria-hidden /> Zurück
		</Button>
	);
}
