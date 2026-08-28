'use client';
import { FormToggleButton, SettingsLink } from '@/components/wg/PageHeaderActions';
import { Loader2, RotateCw } from 'lucide-react';
import Link from 'next/link';

interface PutzenHeaderProps {
	itemCount: number;
	refreshing: boolean;
	busy: boolean;
	showForm: boolean;
	wgBaseHref: string;
	onRefresh: () => void;
	onToggleForm: () => void;
}

export function PutzenHeader({
	itemCount,
	refreshing,
	busy,
	showForm,
	wgBaseHref,
	onRefresh,
	onToggleForm,
}: PutzenHeaderProps) {
	return (
		<header className="flex items-center justify-between gap-3">
			<div>
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
			<div className="flex shrink-0 items-center gap-1.5">
				<button
					type="button"
					onClick={onRefresh}
					disabled={busy}
					aria-label="Putzplan aktualisieren"
					className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-50"
				>
					<RotateCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
				</button>
				<Link
					href={`${wgBaseHref}/aktivitaet`}
					className="hidden h-11 items-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12.5px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] sm:inline-flex"
				>
					Verlauf
				</Link>
				<FormToggleButton
					open={showForm}
					onToggle={onToggleForm}
					controls="add-chore-form"
					openLabel="Putzaufgabe erfassen"
					closeLabel="Putzaufgabe-Formular schließen"
				/>
				<SettingsLink wgBaseHref={wgBaseHref} />
			</div>
		</header>
	);
}
