'use client';
import { CalendarLink, FormToggleButton } from '@/components/wg/PageHeaderActions';
import { Loader2 } from 'lucide-react';

interface PutzenHeaderProps {
	itemCount: number;
	refreshing: boolean;
	showForm: boolean;
	wgBaseHref: string;
	onToggleForm: () => void;
}

export function PutzenHeader({
	itemCount,
	refreshing,
	showForm,
	wgBaseHref,
	onToggleForm,
}: PutzenHeaderProps) {
	return (
		<header className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-1)]">Putzplan</h1>
				<p className="mt-0.5 text-[13px] text-[var(--text-3)]">
					<span aria-live="polite" aria-atomic="true">
						{itemCount} Aufgabe{itemCount === 1 ? '' : 'n'}
					</span>
					{refreshing && (
						<Loader2 className="ml-1.5 inline-block h-3 w-3 animate-spin opacity-50" aria-hidden />
					)}
				</p>
			</div>
			<div className="flex w-full items-center justify-end gap-1.5 sm:w-auto">
				<CalendarLink wgBaseHref={wgBaseHref} />
				<FormToggleButton
					open={showForm}
					onToggle={onToggleForm}
					controls="add-chore-form"
					openLabel="Putzaufgabe erfassen"
					closeLabel="Putzaufgabe-Formular schließen"
				/>
			</div>
		</header>
	);
}
