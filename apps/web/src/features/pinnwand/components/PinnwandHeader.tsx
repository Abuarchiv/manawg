'use client';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { CalendarLink } from '@/components/wg/PageHeaderActions';
import { MessageCircle, Plus, X } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';

interface PinnwandHeaderProps {
	itemCount: number;
	refreshing: boolean;
	composerOpen: boolean;
	composerBusy: boolean;
	loading: boolean;
	hasDraft: boolean;
	wgBaseHref: string;
	onToggleComposer: () => void;
}

export function PinnwandHeader({
	itemCount,
	refreshing,
	composerOpen,
	composerBusy,
	loading,
	hasDraft,
	wgBaseHref,
	onToggleComposer,
}: PinnwandHeaderProps): React.ReactElement {
	return (
		<header className="flex flex-col gap-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<h1 className="text-xl font-semibold tracking-tight">Pinnwand</h1>
					{(loading || itemCount > 0 || refreshing) && (
						<p className="flex items-center gap-2 text-xs text-muted-foreground">
							{loading
								? 'Beiträge werden geladen…'
								: `${itemCount} Beitr${itemCount === 1 ? 'ag' : 'äge'}`}
							{refreshing && <Spinner aria-label="Wird aktualisiert" />}
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center justify-end gap-2">
					<div className="hidden sm:block">
						<CalendarLink wgBaseHref={wgBaseHref} />
					</div>
					<Button
						variant="ghost"
						size="icon"
						nativeButton={false}
						render={<Link href={`${wgBaseHref}/chat`} aria-label="Chat öffnen" />}
					>
						<MessageCircle aria-hidden />
					</Button>
					<Button
						onClick={onToggleComposer}
						disabled={composerBusy || loading}
						variant={composerOpen ? 'outline' : 'default'}
						className="w-9 shrink-0 px-0 sm:w-auto sm:px-3"
						aria-expanded={composerOpen}
						aria-controls="announcement-composer"
						aria-label={
							composerOpen
								? 'Beitragsformular schließen'
								: hasDraft
									? 'Entwurf fortsetzen'
									: 'Beitrag erstellen'
						}
					>
						{composerOpen ? (
							<X data-icon="inline-start" aria-hidden />
						) : (
							<Plus data-icon="inline-start" aria-hidden />
						)}
						<span className="hidden sm:inline">
							{composerOpen ? 'Schließen' : hasDraft ? 'Entwurf' : 'Beitrag'}
						</span>
					</Button>
				</div>
			</div>
			{/* The page title identifies Pinnwand; Chat is a single header action. */}
		</header>
	);
}
