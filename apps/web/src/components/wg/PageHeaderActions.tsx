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
			className="btn-app-primary inline-flex h-11 w-11 shrink-0 justify-center rounded-md p-0 sm:w-auto sm:justify-start sm:px-3"
		>
			{open ? (
				<>
					<X className="h-5 w-5 sm:h-3.5 sm:w-3.5" aria-hidden />
					<span className="hidden sm:inline">Schließen</span>
				</>
			) : (
				<>
					<Plus className="h-5 w-5 sm:h-3.5 sm:w-3.5" aria-hidden />
					<span className="hidden sm:inline">Neu</span>
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
