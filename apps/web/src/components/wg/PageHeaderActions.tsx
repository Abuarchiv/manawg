'use client';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';
import { CalendarDays, Plus, Settings, X } from 'lucide-react';
import Link from 'next/link';

/** Shared actions for the responsive headers of the three list pages. */

interface FormToggleButtonProps {
	open: boolean;
	onToggle: () => void;
	/**
	 * id of the form this button reveals, for `aria-controls`. Omitted on
	 * Ausgaben, whose form section carries no id — pointing the attribute at a
	 * missing element is worse than leaving it off.
	 */
	controls?: string;
	/** e.g. "Ausgabe erfassen" — the label shown when the form is closed. */
	openLabel: string;
	/** e.g. "Ausgabenformular schließen". */
	closeLabel: string;
}

export function FormToggleButton({
	open,
	onToggle,
	controls,
	openLabel,
	closeLabel,
}: FormToggleButtonProps) {
	return (
		<Button
			type="button"
			variant="default"
			onClick={onToggle}
			aria-expanded={open}
			{...(controls ? { 'aria-controls': controls } : {})}
			aria-label={open ? closeLabel : openLabel}
			className="h-auto min-h-11 min-w-11 shrink-0 whitespace-normal"
		>
			{open ? (
				<>
					<X data-icon="inline-start" aria-hidden />
					<span>Schließen</span>
				</>
			) : (
				<>
					<Plus data-icon="inline-start" aria-hidden />
					<span>{openLabel}</span>
				</>
			)}
		</Button>
	);
}

export function SettingsLink({ wgBaseHref }: { wgBaseHref: string }) {
	return (
		<Link
			href={`${wgBaseHref}/einstellungen`}
			aria-label="WG-Einstellungen öffnen"
			className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-11')}
		>
			<Settings aria-hidden />
			<span className="sr-only">WG-Einstellungen öffnen</span>
		</Link>
	);
}

export function CalendarLink({ wgBaseHref }: { wgBaseHref: string }) {
	return (
		<Link
			href={`${wgBaseHref}/kalender`}
			aria-label="Termine im Kalender öffnen"
			title="Termine"
			className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'size-11')}
		>
			<CalendarDays aria-hidden />
		</Link>
	);
}
