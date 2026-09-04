'use client';

import { ICON_BUTTON, ICON_BUTTON_BORDERED } from '@/components/ui/styles';
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
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={open}
			{...(controls ? { 'aria-controls': controls } : {})}
			aria-label={open ? closeLabel : openLabel}
			className="btn-app-primary inline-flex min-h-11 min-w-0 justify-center gap-1.5 rounded-md px-3 py-2 text-center"
		>
			{open ? (
				<>
					<X className="h-4 w-4 shrink-0" aria-hidden />
					<span>Schließen</span>
				</>
			) : (
				<>
					<Plus className="h-4 w-4 shrink-0" aria-hidden />
					<span>{openLabel}</span>
				</>
			)}
		</button>
	);
}

export function SettingsLink({ wgBaseHref }: { wgBaseHref: string }) {
	return (
		<Link
			href={`${wgBaseHref}/einstellungen`}
			aria-label="WG-Einstellungen öffnen"
			className={ICON_BUTTON}
		>
			<Settings className="h-4 w-4" aria-hidden />
		</Link>
	);
}

export function CalendarLink({ wgBaseHref }: { wgBaseHref: string }) {
	return (
		<Link
			href={`${wgBaseHref}/kalender`}
			aria-label="Kalender"
			title="Kalender"
			className={ICON_BUTTON_BORDERED}
		>
			<CalendarDays className="h-4 w-4" aria-hidden />
		</Link>
	);
}
