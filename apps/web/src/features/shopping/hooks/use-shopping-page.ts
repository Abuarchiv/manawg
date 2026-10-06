import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { usePendingSet } from '@/core/hooks/usePendingSet';
import { useSyncedCollection } from '@/core/sync/use-synced-collection';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import { useShoppingAdd } from '@/features/shopping/hooks/use-shopping-add';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShoppingActionContext } from './shopping-action-context';
import { useShoppingRemoval } from './use-shopping-removal';
import { useShoppingToggle } from './use-shopping-toggle';

interface ShoppingResponse {
	items: ShoppingItem[];
}

interface UseShoppingPageOptions {
	wg: { id: string; shareCode: string };
	identity: { memberId: string };
	prefillName: string | null;
	highlightedId: string | null;
	/** Only feeds suggestions: a failed refresh must not block the list. */
	refreshInventory: () => unknown;
}

/** The shopping list: synced items, deep-link highlight and the add/toggle/remove actions. */
export function useShoppingPage({
	wg,
	identity,
	prefillName,
	highlightedId,
	refreshInventory,
}: UseShoppingPageOptions) {
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const [doneOpen, setDoneOpen] = useState(false);
	const [addNotice, setAddNotice] = useState<string | null>(null);
	const [toggleError, setToggleError] = useState<string | null>(null);
	const [toggleNotice, setToggleNotice] = useState<string | null>(null);
	const { isPending, start, end } = usePendingSet();
	// Checking off shows no "saving" state; this only guards against double taps.
	const togglingRef = useRef(new Set<string>());

	const shopping = useSyncedCollection<ShoppingResponse, ShoppingItem>({
		url: `/api/wg/${encodedShareCode}/shopping`,
		memberId: identity.memberId,
		select: (data) => data.items,
		assemble: (items, current) => ({ ...current, items }),
		getId: (item) => item.id,
		describeError: (error) => getWgLoadErrorMessage('Einkaufsliste', error.status, error.error),
		// A failed background refresh keeps the list on screen without a banner.
		hideError: (_error, { silent, hasData }) => silent && hasData,
		reload: (reason) => void load(reason !== 'mount'),
		offline: {
			shareCode: wg.shareCode,
			page: 'einkauf',
			// The "queued offline" notices are outdated once the queue reached the server.
			onReplayed: () => {
				setAddNotice(null);
				setToggleNotice(null);
			},
		},
	});
	const { items, commit, pending, refreshCount } = shopping;
	const loadCollection = shopping.load;

	const load = useCallback(
		async (silent = false, afterMutation = false): Promise<void> => {
			const result = await loadCollection({ silent, afterMutation });
			if (result?.ok) void refreshInventory();
		},
		[loadCollection, refreshInventory],
	);

	const ctx: ShoppingActionContext = {
		wg,
		memberId: identity.memberId,
		encodedShareCode,
		commit,
		pending,
		load,
		refreshCount,
		isPending,
		togglingRef,
		setToggleError,
		setToggleNotice,
	};
	const toggleBought = useShoppingToggle(ctx);
	const removal = useShoppingRemoval({ ...ctx, start, end });

	const add = useShoppingAdd({
		wg,
		identity,
		prefillName,
		commitItems: commit,
		pending,
		load,
		refreshCount,
		// A new add attempt also clears the previous toggle error.
		setAddNotice: (notice) => {
			setAddNotice(notice);
			if (notice === null) setToggleError(null);
		},
	});

	// Jump to a deep-linked item once, not again on every poll or refresh.
	const itemCount = items.length;
	const scrolledHighlightRef = useRef<string | null>(null);
	useEffect(() => {
		if (!highlightedId || itemCount === 0) return;
		if (scrolledHighlightRef.current === highlightedId) return;
		scrolledHighlightRef.current = highlightedId;
		if (items.some((item) => item.id === highlightedId && item.boughtAt !== null))
			setDoneOpen(true);
		window.setTimeout(() => {
			document.getElementById(`shopping-${highlightedId}`)?.scrollIntoView({
				block: 'center',
			});
		}, 80);
	}, [highlightedId, itemCount, items]);

	return {
		items,
		initialLoading: shopping.initialLoading,
		loadError: shopping.loadError,
		load,
		queuedCount: shopping.queuedCount,
		doneOpen,
		setDoneOpen,
		addNotice,
		toggleError,
		toggleNotice,
		removeError: removal.removeError,
		removeErrorId: removal.removeErrorId,
		clearingBought: removal.clearingBought,
		isPending,
		toggleBought,
		remove: removal.remove,
		clearBought: removal.clearBought,
		add,
	};
}
