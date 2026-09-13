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
			className="min-h-11 min-w-max flex-1 gap-1 whitespace-nowrap px-2 text-[13px]"
		>
			{icon}
			{label}
		</Button>
	);
}
