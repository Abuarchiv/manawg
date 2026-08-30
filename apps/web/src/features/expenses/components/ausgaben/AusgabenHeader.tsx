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
		<header className="flex items-center justify-between gap-3">
			<div className="min-w-0">
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
