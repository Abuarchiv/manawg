'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Item, ItemContent, ItemGroup } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { SubNav } from '@/components/wg/SubNav';
import { ThumbAction } from '@/components/wg/ThumbAction';
import { useWg } from '@/components/wg/WgContextProvider';
import { InventoryList } from '@/features/inventory/components/InventoryList';
import { useInventoryPage } from '@/features/inventory/hooks/use-inventory-page';
import { Plus } from 'lucide-react';

export default function VorraetePage() {
	const { wg, identity } = useWg();
	const { items, initialLoading, loadError, addOpen, setAddOpen, load, onChanged } =
		useInventoryPage(wg.shareCode, identity.memberId);

	return (
		<div data-household-content className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3">
			<SubNav />
			{/* Der aktive Tab benennt die Seite schon; Titel und Zähler bleiben für Screenreader. */}
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
				<Card className="py-0">
					<CardContent className="p-0">
						<ItemGroup className="gap-0" aria-busy="true" aria-label="Vorräte werden geladen">
							{['s0', 's1', 's2'].map((k) => (
								<Item key={k} className="px-3 py-3">
									<ItemContent className="flex-1 gap-2">
										<Skeleton className="h-3.5 w-2/5" />
										<Skeleton className="h-3 w-3/5" />
									</ItemContent>
								</Item>
							))}
						</ItemGroup>
					</CardContent>
				</Card>
			) : loadError && items.length === 0 ? null : (
				<InventoryList
					items={items}
					shareCode={wg.shareCode}
					memberId={identity.memberId}
					onChanged={onChanged}
					addOpen={addOpen}
					onAddOpenChange={setAddOpen}
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
