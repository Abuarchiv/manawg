'use client';

import { buttonVariants } from '@/components/ui/button';
import { FormToggleButton } from '@/components/wg/PageHeaderActions';
import { cn } from '@/shared/lib/cn';
import { FileInput } from 'lucide-react';
import Link from 'next/link';

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
		// Der aktive Tab benennt die Seite schon; Titel und Zähler bleiben für Screenreader.
		<header className="flex flex-wrap items-center justify-end gap-2">
			<div className="sr-only">
				<h1 className="font-heading text-[26px] leading-8 font-semibold tracking-tight text-foreground">
					Ausgaben
				</h1>
				<p
					aria-live="polite"
					aria-atomic="true"
					className="mt-0.5 text-[13px] text-muted-foreground tabular-nums"
				>
					{initialLoading ? '' : `${expenseCount} ${expenseCount === 1 ? 'Eintrag' : 'Einträge'}`}
				</p>
			</div>
			<div
				className="flex min-w-0 flex-wrap items-center justify-end gap-2"
				role="toolbar"
				aria-label="Ausgaben-Aktionen"
			>
				<Link
					href={`${wgBaseHref}/import`}
					aria-label="Kontoauszug importieren"
					title="Import"
					className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
				>
					<FileInput aria-hidden />
				</Link>
				<FormToggleButton
					open={showForm}
					onToggle={onToggleForm}
					openLabel="Ausgabe erfassen"
					closeLabel="Ausgabenformular schließen"
					secondary
				/>
			</div>
		</header>
	);
}
