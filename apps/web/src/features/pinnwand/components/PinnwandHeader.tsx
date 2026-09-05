'use client';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { CalendarLink } from '@/components/wg/PageHeaderActions';
import { MessageCircle, Plus, StickyNote, X } from 'lucide-react';
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
		<header className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="text-xs text-muted-foreground">Austausch</p>
					<h1 className="text-2xl font-semibold tracking-tight">Pinnwand</h1>
					<p className="flex items-center gap-2 text-sm text-muted-foreground">
						{loading
							? 'Beiträge werden geladen…'
							: itemCount === 0
								? 'Noch keine Beiträge'
								: `${itemCount} Beitr${itemCount === 1 ? 'ag' : 'äge'}`}
						{refreshing && <Spinner aria-label="Wird aktualisiert" />}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<CalendarLink wgBaseHref={wgBaseHref} />
					<Button
						onClick={onToggleComposer}
						disabled={composerBusy || loading}
						variant={composerOpen ? 'outline' : 'default'}
						className="min-h-11"
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
						{composerOpen ? 'Schließen' : hasDraft ? 'Entwurf' : 'Beitrag'}
					</Button>
				</div>
			</div>
			<nav aria-label="Austausch" className="grid grid-cols-2 gap-2">
				<Button
					variant="secondary"
					className="min-h-11"
					nativeButton={false}
					render={<Link href={`${wgBaseHref}/pinnwand`} aria-current="page" />}
				>
					<StickyNote data-icon="inline-start" aria-hidden /> Pinnwand
				</Button>
				<Button
					variant="ghost"
					className="min-h-11"
					nativeButton={false}
					render={<Link href={`${wgBaseHref}/chat`} />}
				>
					<MessageCircle data-icon="inline-start" aria-hidden /> Chat
				</Button>
			</nav>
		</header>
	);
}
