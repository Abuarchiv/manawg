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
import { MS_PER_DAY } from '@/core/utils/time';
import { InventoryRestockPrompt } from '@/features/inventory/components/InventoryRestockPrompt';
import type { InventoryItemDto } from '@/features/inventory/inventory';
import { ClearBoughtDialog } from '@/features/shopping/components/ClearBoughtDialog';
import { ListSkeleton, SuggestionsSkeleton } from '@/features/shopping/components/ListSkeleton';
import { ShoppingAddBar } from '@/features/shopping/components/ShoppingAddBar';
import { ShoppingList } from '@/features/shopping/components/ShoppingList';
import { ShoppingReceiptPrompt } from '@/features/shopping/components/ShoppingReceiptPrompt';
import { ShoppingSuggestions } from '@/features/shopping/components/ShoppingSuggestions';
import { useShoppingPage } from '@/features/shopping/hooks/use-shopping-page';
import { splitShoppingItems } from '@/features/shopping/shopping-view';
import { ListChecks } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { buildSuggestionGroups } from './shopping-suggestions';

const NO_INVENTORY: InventoryItemDto[] = [];
/** Only the buyer's own purchases of the last hours trigger the restock prompt. */
const RESTOCK_WINDOW_MS = MS_PER_DAY / 2;

export default function EinkaufPage() {
	const { wg, members, identity, isAdmin } = useWg();
	const searchParams = useSearchParams();
	const highlightedId = searchParams.get('highlight');
	const prefillName = searchParams.get('name');
	const {
		data: cachedInventory,
		isLoading: inventoryLoading,
		error: inventoryError,
		refresh: refreshInventory,
	} = useCachedFetch<{
		items: InventoryItemDto[];
	}>(`/api/wg/${encodeURIComponent(wg.shareCode)}/inventory`, {
		memberId: identity.memberId,
	});
	const shopping = useShoppingPage({ wg, identity, prefillName, highlightedId, refreshInventory });
	const { items, initialLoading, loadError, add } = shopping;
	const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
	const headingRef = useRef<HTMLHeadingElement>(null);
	// Row or done block disappears together with its focus: keep it on the page instead of letting it fall to BODY.
	const keepFocus = (ok: boolean): void => {
		if (ok) requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
	};

	// Derived directly instead of mirrored via an effect: otherwise one frame
	// renders with an empty pantry and the suggestions jump.
	const inventory = cachedInventory?.items ?? NO_INVENTORY;
	const { open, done, openItems, doneItems } = splitShoppingItems(items);
	const actionError =
		shopping.toggleError ?? (shopping.removeErrorId ? null : shopping.removeError);

	// Suggestions and list appear together once list and pantry are loaded: otherwise
	// the groups swap after loading and push the list down (layout shift).
	// Without a list (load error) the open items are unknown, so nothing is offered for adding.
	const listUnknown = Boolean(loadError) && items.length === 0;
	// Only the first load without an error holds the suggestions back; a slow or failing pantry
	// request must never hide the list itself.
	const inventoryPending = inventoryLoading && !inventoryError && cachedInventory === undefined;
	const suggestionsPending = initialLoading || inventoryPending || listUnknown;
	const now = Date.now();
	const suggestionGroups = suggestionsPending
		? []
		: buildSuggestionGroups({ items, inventory, now });

	return (
		<div data-household-content className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3">
			<SubNav liveCount={!initialLoading && !loadError ? open.length : undefined} />
			{/* The active tab already names the page; title and count stay for screen readers. */}
			<header className="sr-only">
				<h1 ref={headingRef} tabIndex={-1}>
					Einkäufe
				</h1>
				<p aria-live="polite" aria-atomic="true">
					{initialLoading && items.length === 0 ? 'Lädt…' : `${open.length} offen`}
				</p>
			</header>

			{inventoryPending && !initialLoading && !listUnknown && <SuggestionsSkeleton />}
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
			{initialLoading && items.length === 0 ? (
				<ListSkeleton withSuggestions />
			) : listUnknown ? null : items.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<ListChecks aria-hidden />
						</EmptyMedia>
						<EmptyTitle>Noch nichts auf der Liste</EmptyTitle>
						<EmptyDescription>
							{suggestionGroups.length > 0
								? 'Schreib unten einen Artikel auf oder tippe einen Vorschlag.'
								: 'Schreib unten einen Artikel auf.'}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ShoppingList
					openItems={openItems}
					doneItems={doneItems}
					members={members}
					memberId={identity.memberId}
					shareCode={wg.shareCode}
					highlightedId={shopping.flashId ?? highlightedId}
					doneOpen={shopping.doneOpen}
					onDoneOpenChange={shopping.setDoneOpen}
					isPending={shopping.isPending}
					onToggle={shopping.toggleBought}
					onRemove={(id, name) => shopping.remove(id, name).then(keepFocus)}
					onEdit={shopping.edit}
					removeError={shopping.removeError}
					removeErrorId={shopping.removeErrorId}
					isAdmin={isAdmin}
					clearingBought={shopping.clearingBought}
					onClearRequest={() => setClearConfirmOpen(true)}
					queuedCount={shopping.queuedCount}
				/>
			)}
			<ShoppingReceiptPrompt
				doneItems={doneItems}
				memberId={identity.memberId}
				shareCode={wg.shareCode}
			/>
			<InventoryRestockPrompt
				items={inventory}
				boughtNames={done
					.filter(
						(item) =>
							item.boughtByMemberId === identity.memberId &&
							item.boughtAt !== null &&
							now - Date.parse(item.boughtAt) < RESTOCK_WINDOW_MS,
					)
					.map((item) => item.name)}
				shareCode={wg.shareCode}
				memberId={identity.memberId}
				onRestocked={refreshInventory}
			/>
			<ShoppingAddBar
				value={add.newName}
				onChange={add.changeName}
				onSubmit={() => void add.add()}
				adding={add.adding}
				addError={add.addError}
				addNotice={shopping.addNotice}
				actionError={actionError}
				toggleNotice={shopping.toggleNotice}
			/>
			{isAdmin && (
				<ClearBoughtDialog
					open={clearConfirmOpen}
					onOpenChange={setClearConfirmOpen}
					doneCount={done.length}
					clearing={shopping.clearingBought}
					onConfirm={() => void shopping.clearBought().then(keepFocus)}
				/>
			)}
		</div>
	);
}
