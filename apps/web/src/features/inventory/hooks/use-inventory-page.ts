import type { DashboardData } from '@/composition/dashboard-data';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { refreshCachedFetch, useCachedFetch } from '@/core/hooks/useCachedFetch';
import { useStableCallback } from '@/core/hooks/useStableCallback';
import { isNetworkError } from '@/core/http/error-codes';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import {
	type InventoryCategory,
	type InventoryItemDto,
	type InventoryMutationItemDto,
	groupItemsByCategory,
	isBelowThreshold,
} from '@/features/inventory/inventory';
import { useCallback, useEffect, useRef, useState } from 'react';

interface InventoryResponse {
	items: InventoryItemDto[];
	grouped: Record<InventoryCategory, InventoryItemDto[]>;
}

function applyInventoryMutation(
	items: InventoryItemDto[],
	updated?: InventoryMutationItemDto,
	deletedId?: string,
): InventoryItemDto[] {
	if (deletedId) return items.filter((item) => item.id !== deletedId);
	if (!updated) return items;
	const existing = items.find((item) => item.id === updated.id);
	const merged: InventoryItemDto = {
		...(existing ?? {}),
		...updated,
		decrementCount30d: updated.decrementCount30d ?? existing?.decrementCount30d ?? 0,
	};
	return existing
		? items.map((item) => (item.id === updated.id ? merged : item))
		: [...items, merged];
}

/** Laden, Cache und Auto-Refresh der Vorräte; `onChanged` übernimmt Mutationen sofort in die Liste. */
export function useInventoryPage(shareCode: string, memberId: string, memberToken?: string) {
	const encodedShareCode = encodeURIComponent(shareCode);
	const inventoryUrl = `/api/wg/${encodedShareCode}/inventory`;
	const {
		data: inventoryData,
		error: inventoryError,
		isLoading: inventoryLoading,
		refresh: refreshInventory,
		setData: setInventoryData,
	} = useCachedFetch<InventoryResponse>(inventoryUrl, {
		memberId: memberId,
	});
	const [items, setItems] = useState<InventoryItemDto[]>(() => inventoryData?.items ?? []);
	const [initialLoading, setInitialLoading] = useState(inventoryLoading);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [addOpen, setAddOpen] = useState(false);
	const requestIdRef = useRef(0);
	const hasInventoryDataRef = useRef(inventoryData !== undefined);

	const load = useCallback(
		async (silent = false): Promise<void> => {
			const requestId = requestIdRef.current + 1;
			requestIdRef.current = requestId;
			if (!silent && !hasInventoryDataRef.current) setInitialLoading(true);
			const res = await refreshInventory();
			if (requestId !== requestIdRef.current) {
				return;
			}
			if (res.ok) {
				setLoadError(null);
				setItems(res.data.items);
			} else if (
				(!silent || !hasInventoryDataRef.current) &&
				!(hasInventoryDataRef.current && isNetworkError(res.error, res.status))
			) {
				// Ein stiller Hintergrund-Refresh legt keinen Fehler über eine brauchbare Liste.
				setLoadError(getWgLoadErrorMessage('Vorräte', res.status, res.error));
			}
			setInitialLoading(false);
		},
		[refreshInventory],
	);

	useEffect(() => {
		if (inventoryData) {
			hasInventoryDataRef.current = true;
			setItems(inventoryData.items);
			setLoadError(null);
		} else if (inventoryError) {
			setLoadError(getWgLoadErrorMessage('Vorräte', inventoryError.status, inventoryError.error));
		}
	}, [inventoryData, inventoryError]);

	useEffect(() => {
		void load(false);
	}, [load]);
	// Auto-Refresh wie auf dem Dashboard — ersetzt den manuellen Reload-Button.
	useVisibilityPausedInterval(() => void load(true), 30_000);

	const onChanged = useStableCallback(
		(updated?: InventoryMutationItemDto, deletedId?: string): void => {
			if (updated || deletedId) {
				setItems((prev) => applyInventoryMutation(prev, updated, deletedId));
				setInventoryData((current) => {
					if (!current && !updated) return current;
					const nextItems = applyInventoryMutation(current?.items ?? [], updated, deletedId);
					return {
						items: nextItems,
						grouped: groupItemsByCategory(nextItems),
					};
				});
			}
			// Zähler „Einkäufe“ in der Unternavigation: Unter dem Schwellwert legt der Server automatisch
			// einen Einkaufsartikel an, den der Dashboard-Cache sonst erst beim nächsten Fokus kennt.
			if (updated && isBelowThreshold(updated)) {
				void refreshCachedFetch<DashboardData>(`/api/wg/${encodedShareCode}/dashboard`, {
					memberId,
					memberToken,
				});
			}
			void load(true);
		},
	);

	return { items, initialLoading, loadError, addOpen, setAddOpen, load, onChanged };
}
