'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ItemContent, ItemEntry, ItemGroup } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { SubNav } from '@/components/wg/SubNav';
import { ThumbAction } from '@/components/wg/ThumbAction';
import { useWg } from '@/components/wg/WgContextProvider';
import { InventoryList } from '@/features/inventory/components/InventoryList';
import { useInventoryPage } from '@/features/inventory/hooks/use-inventory-page';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/** How long the ring stays around the item reached via link. */
const HIGHLIGHT_MS = 3000;

export default function VorraetePage() {
	const { wg, identity } = useWg();
	const { items, initialLoading, loadError, addOpen, setAddOpen, load, onChanged } =
		useInventoryPage(wg.shareCode, identity.memberId);

	// Deep link from the notification (?highlight=<id>): scroll to the center once, show the ring briefly.
	const targetId = useSearchParams().get('highlight');
	const [highlightedId, setHighlightedId] = useState<string | null>(null);
	const targetFound = targetId !== null && items.some((item) => item.id === targetId);
	useEffect(() => {
		if (!targetId || !targetFound) return;
		setHighlightedId(targetId);
		const scrollTimer = window.setTimeout(() => {
			document.getElementById(`inventory-${targetId}`)?.scrollIntoView({ block: 'center' });
		}, 80);
		const clearTimer = window.setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
		return () => {
			window.clearTimeout(scrollTimer);
			window.clearTimeout(clearTimer);
		};
	}, [targetId, targetFound]);

	return (
		<div data-household-content className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3">
			<SubNav />
			{/* The active tab already names the page; title and count stay for screen readers. */}
			<header className="sr-only">
				<div className="min-w-0 flex-1">
					<h1 tabIndex={-1}>Vorräte</h1>
					<p
						className="mt-0.5 text-[12px] text-muted-foreground tabular-nums"
						aria-live="polite"
						aria-atomic="true"
					>
						{initialLoading && items.length === 0
							? 'Lädt…'
							: loadError && items.length === 0
								? 'Derzeit nicht verfügbar'
								: items.length === 0
									? null
									: `${items.length} Artikel im Bestand`}
					</p>
				</div>
			</header>

			{loadError && (
				<Alert variant="destructive">
					<AlertTitle>Laden fehlgeschlagen</AlertTitle>
					<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
						<span>{loadError}</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void load(false)}
							disabled={initialLoading}
						>
							{initialLoading && <Spinner aria-hidden />}
							{initialLoading ? 'Lädt…' : 'Erneut laden'}
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{initialLoading && items.length === 0 ? (
				<div className="flex flex-col gap-2">
					{/* Group heading of the loaded list: content does not jump down on load. */}
					<div className="flex h-5 items-center">
						<Skeleton className="h-3.5 w-24" />
					</div>
					<Card className="py-0">
						<CardContent className="p-0">
							<ItemGroup className="gap-0" aria-busy="true" aria-label="Vorräte werden geladen">
								{['s0', 's1', 's2'].map((k) => (
									<ItemEntry key={k} className="px-3 py-3">
										<ItemContent className="flex-1 gap-2">
											<Skeleton className="h-3.5 w-2/5" />
											<Skeleton className="h-3 w-3/5" />
										</ItemContent>
									</ItemEntry>
								))}
							</ItemGroup>
						</CardContent>
					</Card>
				</div>
			) : loadError && items.length === 0 ? null : (
				<InventoryList
					items={items}
					shareCode={wg.shareCode}
					memberId={identity.memberId}
					onChanged={onChanged}
					addOpen={addOpen}
					onAddOpenChange={setAddOpen}
					highlightedId={highlightedId}
				/>
			)}
			{!(initialLoading && items.length === 0) && !(loadError && items.length === 0) && (
				<ThumbAction>
					<Button type="button" className="min-h-11 w-full" onClick={() => setAddOpen(true)}>
						<Plus data-icon="inline-start" aria-hidden />
						Vorrat hinzufügen
					</Button>
				</ThumbAction>
			)}
			<div aria-hidden className="h-[env(safe-area-inset-bottom,0px)]" />
		</div>
	);
}
