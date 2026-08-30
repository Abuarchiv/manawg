'use client';
import { CalendarLink, FormToggleButton } from '@/components/wg/PageHeaderActions';
import { Loader2 } from 'lucide-react';
import type React from 'react';

interface PinnwandHeaderProps {
	itemCount: number;
	refreshing: boolean;
	composerOpen: boolean;
	wgBaseHref: string;
	onToggleComposer: () => void;
}

export function PinnwandHeader({
	itemCount,
	refreshing,
	composerOpen,
	wgBaseHref,
	onToggleComposer,
}: PinnwandHeaderProps): React.ReactElement {
	return (
		<header className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-1)]">Pinnwand</h1>
				<p className="mt-0.5 text-[13px] text-[var(--text-3)]">
					{itemCount === 0
						? 'Noch keine Beiträge'
						: `${itemCount} Beitr${itemCount === 1 ? 'ag' : 'äge'}`}
					{refreshing && (
						<Loader2 className="ml-1.5 inline-block h-3 w-3 animate-spin opacity-50" aria-hidden />
					)}
				</p>
			</div>
			<div className="flex w-full items-center justify-end gap-1.5 sm:w-auto">
				<CalendarLink wgBaseHref={wgBaseHref} />
				<FormToggleButton
					open={composerOpen}
					onToggle={onToggleComposer}
					controls="announcement-composer"
					openLabel="Beitrag erstellen"
					closeLabel="Beitragsformular schließen"
				/>
			</div>
		</header>
	);
}
