'use client';
import { Spinner } from '@/components/ui/spinner';
import { FormToggleButton } from '@/components/wg/PageHeaderActions';
import type { getChorePlanHealth } from '@/features/chores/chore-status';

interface PutzenHeaderProps {
	itemCount: number;
	loading: boolean;
	health: ReturnType<typeof getChorePlanHealth> | null;
	refreshing: boolean;
	showForm: boolean;
	onToggleForm: () => void;
}

export function PutzenHeader({
	itemCount,
	loading,
	health,
	refreshing,
	showForm,
	onToggleForm,
}: PutzenHeaderProps) {
	return (
		<header className="flex flex-wrap items-center justify-between gap-2">
			<div className="min-w-0">
				<h1 className="font-heading text-[26px] leading-8 font-semibold tracking-tight text-foreground">
					Putzplan
				</h1>
				<p
					className="mt-0.5 text-[13px] text-muted-foreground tabular-nums flex items-center gap-1.5"
					aria-live="polite"
					aria-atomic="true"
				>
					{loading
						? 'Lädt…'
						: [
								`${itemCount} Aufgabe${itemCount === 1 ? '' : 'n'}`,
								health?.dueToday ? `${health.dueToday} heute fällig` : null,
								health?.gaps ? `${health.gaps} offen` : null,
								health?.escalated ? `${health.escalated} Klärung offen` : null,
							]
								.filter(Boolean)
								.join(' · ')}
					{refreshing && <Spinner className="size-3 opacity-50" aria-hidden />}
				</p>
			</div>
			<div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
				<FormToggleButton
					open={showForm}
					onToggle={onToggleForm}
					controls="add-chore-form"
					openLabel="Putzaufgabe erfassen"
					closeLabel="Putzaufgabe-Formular schließen"
					secondary
				/>
			</div>
		</header>
	);
}
