'use client';

import { ICON_BUTTON_BORDERED } from '@/components/ui/styles';
import { FormToggleButton, SettingsLink } from '@/components/wg/PageHeaderActions';
import { RotateCw } from 'lucide-react';
import Link from 'next/link';

interface AusgabenHeaderProps {
	expenseCount: number;
	initialLoading: boolean;
	refreshing: boolean;
	wgBaseHref: string;
	showForm: boolean;
	onRefresh: () => void;
	onToggleForm: () => void;
}

export function AusgabenHeader({
	expenseCount,
	initialLoading,
	refreshing,
	wgBaseHref,
	showForm,
	onRefresh,
	onToggleForm,
}: AusgabenHeaderProps): React.ReactElement {
	return (
		<header className="flex items-center justify-between gap-3">
			<div>
				<h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-1)]">Ausgaben</h1>
				<p
					aria-live="polite"
					aria-atomic="true"
					className="mt-0.5 text-[13px] text-[var(--text-3)]"
				>
					{initialLoading ? '' : `${expenseCount} ${expenseCount === 1 ? 'Eintrag' : 'Einträge'}`}
				</p>
			</div>
			<div
				className="flex shrink-0 items-center gap-1.5"
				role="toolbar"
				aria-label="Ausgaben-Aktionen"
			>
				<button
					type="button"
					onClick={onRefresh}
					disabled={initialLoading || refreshing}
					aria-label="Ausgaben aktualisieren"
					title="Ausgaben aktualisieren"
					className={ICON_BUTTON_BORDERED}
				>
					<RotateCw
						className={`h-4 w-4 ${initialLoading || refreshing ? 'animate-spin' : ''}`}
						aria-hidden
					/>
				</button>
				<Link
					href={`${wgBaseHref}/aktivitaet`}
					className="hidden h-11 items-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12.5px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 sm:inline-flex"
				>
					Verlauf
				</Link>
				<FormToggleButton
					open={showForm}
					onToggle={onToggleForm}
					openLabel="Ausgabe erfassen"
					closeLabel="Ausgabenformular schließen"
				/>
				<SettingsLink wgBaseHref={wgBaseHref} />
			</div>
		</header>
	);
}
