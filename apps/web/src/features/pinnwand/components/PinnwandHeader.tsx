'use client';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
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
	showComposerToggle?: boolean;
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
	showComposerToggle = true,
	wgBaseHref,
	onToggleComposer,
}: PinnwandHeaderProps): React.ReactElement {
	return (
		<header className="flex flex-col gap-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<h1 className="font-heading text-[26px] leading-8 font-semibold tracking-tight text-foreground">
						Pinnwand
					</h1>
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
					<Button
						variant="ghost"
						size="icon"
						nativeButton={false}
						render={<Link href={`${wgBaseHref}/chat`} aria-label="Chat öffnen" />}
						className="shrink-0"
					>
						<MessageCircle aria-hidden />
					</Button>
					{showComposerToggle && (
						<Button
							onClick={onToggleComposer}
							disabled={composerBusy || loading}
							variant={composerOpen ? 'outline' : 'default'}
							className="w-9 shrink-0 p-0"
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
						</Button>
					)}
				</div>
			</div>
			{/* The page title identifies Pinnwand; Chat is a single header action. */}
		</header>
	);
}
