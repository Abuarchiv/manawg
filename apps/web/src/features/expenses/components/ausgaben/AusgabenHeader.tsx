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
		<header className="flex flex-wrap items-center justify-between gap-2">
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
				className="flex min-w-0 flex-wrap items-center justify-end gap-1.5"
				role="toolbar"
				aria-label="Ausgaben-Aktionen"
			>
				<div className="hidden sm:block">
					<CalendarLink wgBaseHref={wgBaseHref} />
				</div>
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
