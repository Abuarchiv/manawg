'use client';

import { CalendarLink, FormToggleButton } from '@/components/wg/PageHeaderActions';

interface AusgabenHeaderProps {
	expenseCount: number;
	initialLoading: boolean;
	showForm: boolean;
	wgBaseHref: string;
	onToggleForm: () => void;
}

export function AusgabenHeader({
	expenseCount,
	initialLoading,
	showForm,
	wgBaseHref,
	onToggleForm,
}: AusgabenHeaderProps): React.ReactElement {
	return (
		<header className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<h1 className="text-[22px] font-semibold tracking-tight text-foreground">Ausgaben</h1>
				<p
					aria-live="polite"
					aria-atomic="true"
					className="mt-0.5 text-[13px] text-muted-foreground"
				>
					{initialLoading ? '' : `${expenseCount} ${expenseCount === 1 ? 'Eintrag' : 'Einträge'}`}
				</p>
			</div>
			<div
				className="flex items-center justify-end gap-1.5"
				role="toolbar"
				aria-label="Ausgaben-Aktionen"
			>
				<CalendarLink wgBaseHref={wgBaseHref} />
				<FormToggleButton
					open={showForm}
					onToggle={onToggleForm}
					openLabel="Ausgabe erfassen"
					closeLabel="Ausgabenformular schließen"
				/>
			</div>
		</header>
	);
}
