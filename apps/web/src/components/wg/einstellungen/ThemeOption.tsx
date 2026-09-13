'use client';

import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';

interface ThemeOptionProps {
	label: string;
	icon: ReactNode;
	active: boolean;
	onClick: () => void;
}

export function ThemeOption({ label, icon, active, onClick }: ThemeOptionProps) {
	return (
		<Button
			type="button"
			variant={active ? 'default' : 'outline'}
			aria-pressed={active}
			onClick={onClick}
			className="h-11 min-h-[44px] min-w-0 flex-1 whitespace-normal text-sm"
		>
			{icon}
			{label}
		</Button>
	);
}
