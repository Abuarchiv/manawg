'use client';
import { FormToggleButton, SettingsLink } from '@/components/wg/PageHeaderActions';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';

interface PinnwandHeaderProps {
	itemCount: number;
	refreshing: boolean;
	wgBaseHref: string;
	composerOpen: boolean;
	onToggleComposer: () => void;
}

export function PinnwandHeader({
	itemCount,
	refreshing,
	wgBaseHref,
	composerOpen,
	onToggleComposer,
}: PinnwandHeaderProps): React.ReactElement {
	return (
		<header className="flex items-center justify-between gap-3">
			<div>
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
			<div className="flex shrink-0 items-center gap-1.5">
				<Link
					href={`${wgBaseHref}/aktivitaet`}
					className="hidden h-11 items-center rounded-md border border-[var(--border)] px-3 text-[12.5px] font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 sm:inline-flex"
				>
					Verlauf
				</Link>
				<FormToggleButton
					open={composerOpen}
					onToggle={onToggleComposer}
					controls="announcement-composer"
					openLabel="Beitrag erstellen"
					closeLabel="Beitragsformular schließen"
				/>
				<SettingsLink wgBaseHref={wgBaseHref} />
			</div>
		</header>
	);
}
