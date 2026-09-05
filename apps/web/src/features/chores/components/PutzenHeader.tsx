'use client';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { CalendarLink, FormToggleButton } from '@/components/wg/PageHeaderActions';

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
		<header className="flex items-center justify-between gap-3">
			<div className="min-w-0">
				<h1 className="text-xl font-semibold tracking-tight text-foreground">Putzplan</h1>
				<p className="mt-1 flex items-center gap-1.5" aria-live="polite" aria-atomic="true">
					<Badge variant="secondary" className="tabular-nums">
						{itemCount} Aufgabe{itemCount === 1 ? '' : 'n'}
					</Badge>
					{refreshing && <Spinner className="size-3 opacity-50" aria-hidden />}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
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
