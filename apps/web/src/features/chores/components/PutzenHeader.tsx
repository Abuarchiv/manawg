'use client';
import { Spinner } from '@/components/ui/spinner';
import { CalendarLink, FormToggleButton } from '@/components/wg/PageHeaderActions';
import type { getChorePlanHealth } from '@/features/chores/chore-status';

interface PutzenHeaderProps {
	itemCount: number;
	health: ReturnType<typeof getChorePlanHealth> | null;
	refreshing: boolean;
	showForm: boolean;
	wgBaseHref: string;
	onToggleForm: () => void;
}

export function PutzenHeader({
	itemCount,
	health,
	refreshing,
	showForm,
	wgBaseHref,
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
					{[
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
				<div className="hidden sm:block">
					<CalendarLink wgBaseHref={wgBaseHref} />
				</div>
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
