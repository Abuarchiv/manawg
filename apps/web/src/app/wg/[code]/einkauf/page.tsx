'use client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { SubNav } from '@/components/wg/SubNav';
import { useWg } from '@/components/wg/WgContextProvider';
import { useCachedFetch } from '@/core/hooks/useCachedFetch';
import { formatQueuedOfflineEntries } from '@/core/offline/offline-copy';
import {
	type InventoryItemDto,
	isBelowThreshold,
	normalizeForMatch,
} from '@/features/inventory/inventory';
import { ClearBoughtDialog } from '@/features/shopping/components/ClearBoughtDialog';
import { ListSkeleton } from '@/features/shopping/components/ListSkeleton';
import { ShoppingAddBar } from '@/features/shopping/components/ShoppingAddBar';
import { ShoppingList } from '@/features/shopping/components/ShoppingList';
import { ShoppingReceiptPrompt } from '@/features/shopping/components/ShoppingReceiptPrompt';
import { ShoppingSuggestions } from '@/features/shopping/components/ShoppingSuggestions';
import { QUICK_SHOPPING_ITEMS } from '@/features/shopping/components/constants';
import { useShoppingPage } from '@/features/shopping/hooks/use-shopping-page';
import { splitShoppingItems } from '@/features/shopping/shopping-view';
import { ListChecks } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

const NO_INVENTORY: InventoryItemDto[] = [];

export default function EinkaufPage() {
	const { wg, members, identity, isAdmin } = useWg();
	const searchParams = useSearchParams();
	const highlightedId = searchParams.get('highlight');
	const prefillName = searchParams.get('name');
	const {
		data: cachedInventory,
		isLoading: inventoryLoading,
		refresh: refreshInventory,
	} = useCachedFetch<{
		items: InventoryItemDto[];
	}>(`/api/wg/${encodeURIComponent(wg.shareCode)}/inventory`, {
		memberId: identity.memberId,
	});
	const shopping = useShoppingPage({ wg, identity, prefillName, highlightedId, refreshInventory });
	const { items, initialLoading, loadError, add } = shopping;
	const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

	// Direkt abgeleitet statt per Effect gespiegelt: sonst rendert ein Frame mit
	// leerem Vorrat und die Vorschläge springen.
	const inventory = cachedInventory?.items ?? NO_INVENTORY;
	const { open, done, openItems, doneItems } = splitShoppingItems(items);
	const actionError =
		shopping.toggleError ?? (shopping.removeErrorId ? null : shopping.removeError);

	// Vorschläge ohne Artikel, die schon offen auf der Liste stehen.
	const openNames = new Set(open.map((item) => normalizeForMatch(item.name)));
	const lowStock = inventory
		.filter((item) => isBelowThreshold(item) && !openNames.has(normalizeForMatch(item.name)))
		.map((item) => item.name);
	const taken = new Set([...openNames, ...lowStock.map(normalizeForMatch)]);
	const frequent = [
		...inventory
			.filter((item) => item.decrementCount30d > 0)
			.sort((a, b) => b.decrementCount30d - a.decrementCount30d)
			.map((item) => item.name),
		...done.map((item) => item.name),
	].filter((name) => {
		const key = normalizeForMatch(name);
		if (taken.has(key)) return false;
		taken.add(key);
		return true;
	});
	// Vorschläge und Liste erscheinen gemeinsam, sobald Liste und Vorrat da sind: sonst
	// tauschen die Gruppen nach dem Laden und schieben die Liste nach unten (Layout Shift).
	const suggestionsPending = initialLoading || inventoryLoading;
	const suggestionGroups = [
		{ label: 'Bald leer', names: lowStock.slice(0, 4) },
		frequent.length > 0
			? { label: 'Oft gekauft', names: frequent.slice(0, 4) }
			: {
					label: 'Vorschläge',
					names:
						items.length === 0
							? QUICK_SHOPPING_ITEMS.map((item) => item.name).filter(
									(name) => !taken.has(normalizeForMatch(name)),
								)
							: [],
				},
	].filter((group) => !suggestionsPending && group.names.length > 0);

	return (
		<div data-household-content className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3">
			<SubNav liveCount={!initialLoading && !loadError ? open.length : undefined} />
			{/* Der aktive Tab benennt die Seite schon; Titel und Zähler bleiben für Screenreader. */}
			<header className="sr-only">
				<h1>Einkäufe</h1>
				<p
					className="mt-0.5 text-[12px] text-muted-foreground tabular-nums"
					aria-live="polite"
					aria-atomic="true"
				>
					{initialLoading && items.length === 0 ? 'Lädt…' : `${open.length} offen`}
				</p>
			</header>

			{suggestionGroups.length > 0 && (
				<ShoppingSuggestions
					groups={suggestionGroups}
					disabled={add.adding}
					onAdd={(name) => void add.add(name)}
				/>
			)}

			{shopping.queuedCount > 0 && (
				<Alert>
					<AlertDescription>{formatQueuedOfflineEntries(shopping.queuedCount)}</AlertDescription>
				</Alert>
			)}
			{loadError && (
				<LoadErrorBanner
					message={loadError}
					onRetry={() => void shopping.load(false)}
					busy={initialLoading}
					retryLabel="Liste erneut laden"
				/>
			)}
			{actionError && (
				<Alert variant="destructive">
					<AlertDescription>{actionError}</AlertDescription>
				</Alert>
			)}
			{shopping.toggleNotice && (
				<Alert>
					<AlertDescription>{shopping.toggleNotice}</AlertDescription>
				</Alert>
			)}
			{inventoryLoading || (initialLoading && items.length === 0) ? (
				<ListSkeleton />
			) : loadError && items.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>Noch keine Artikel geladen</EmptyTitle>
						<EmptyDescription>
							Versuche es erneut, sobald die Verbindung wieder da ist.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : items.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<ListChecks aria-hidden />
						</EmptyMedia>
						<EmptyTitle>Noch nichts auf der Liste</EmptyTitle>
					</EmptyHeader>
				</Empty>
			) : (
				<ShoppingList
					openItems={openItems}
					doneItems={doneItems}
					members={members}
					memberId={identity.memberId}
					shareCode={wg.shareCode}
					highlightedId={highlightedId}
					doneOpen={shopping.doneOpen}
					onDoneOpenChange={shopping.setDoneOpen}
					isPending={shopping.isPending}
					onToggle={shopping.toggleBought}
					onRemove={shopping.remove}
					removeError={shopping.removeError}
					removeErrorId={shopping.removeErrorId}
					isAdmin={isAdmin}
					clearingBought={shopping.clearingBought}
					onClearRequest={() => setClearConfirmOpen(true)}
				/>
			)}
			<ShoppingReceiptPrompt
				doneItems={doneItems}
				memberId={identity.memberId}
				shareCode={wg.shareCode}
			/>
			<ShoppingAddBar
				value={add.newName}
				onChange={add.changeName}
				onSubmit={() => void add.add()}
				adding={add.adding}
				addError={add.addError}
				addNotice={shopping.addNotice}
			/>
			{isAdmin && (
				<ClearBoughtDialog
					open={clearConfirmOpen}
					onOpenChange={setClearConfirmOpen}
					doneCount={done.length}
					clearing={shopping.clearingBought}
					onConfirm={() => void shopping.clearBought()}
				/>
			)}
		</div>
	);
}
