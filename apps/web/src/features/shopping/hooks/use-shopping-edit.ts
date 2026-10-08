import { useToast } from '@/components/ui/Toast';
import { apiFetch } from '@/core/infra/api-client';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import { isTempItemId } from '@/features/shopping/shopping-view';
import { useCallback } from 'react';
import type { ShoppingActionContext } from './shopping-action-context';

type EditContext = Pick<
	ShoppingActionContext,
	'memberId' | 'encodedShareCode' | 'commit' | 'load' | 'togglingRef'
>;

const FAILED = 'Änderung konnte nicht gespeichert werden. Versuche es erneut.';

/** Rename an open item or change its amount; the form shows the returned message, null = saved. */
export function useShoppingEdit(ctx: EditContext) {
	const { memberId, encodedShareCode, commit, load, togglingRef } = ctx;
	const toast = useToast();
	return useCallback(
		async (item: ShoppingItem, name: string, quantity: string | null): Promise<string | null> => {
			if (isTempItemId(item.id) || togglingRef.current.has(item.id)) {
				return 'Der Artikel wird gerade gespeichert. Versuche es gleich noch einmal.';
			}
			const res = await apiFetch<{ item: ShoppingItem }>(
				`/api/wg/${encodedShareCode}/shopping/${encodeURIComponent(item.id)}`,
				{
					method: 'PUT',
					memberId,
					body: JSON.stringify({
						name,
						quantity,
						...(item.updatedAt ? { expectedUpdatedAt: item.updatedAt } : {}),
					}),
				},
			);
			if (!res.ok) {
				if (res.error === 'shopping_item_duplicate') {
					return 'Diesen Artikel gibt es schon offen auf der Liste.';
				}
				if (res.error === 'shopping_item_changed') {
					void load(true);
					return 'Der Artikel wurde inzwischen gekauft oder geändert. Die Liste wird aktualisiert.';
				}
				if (res.status === 404) {
					void load(true);
					return 'Diesen Artikel gibt es nicht mehr.';
				}
				if (res.status === 0) return 'Ohne Verbindung lässt sich ein Artikel nicht ändern.';
				return FAILED;
			}
			const saved = res.data.item;
			commit((current) =>
				current.map((entry) =>
					entry.id === item.id
						? {
								...entry,
								name: saved.name,
								quantity: saved.quantity,
								...(saved.updatedAt ? { updatedAt: saved.updatedAt } : {}),
							}
						: entry,
				),
			);
			toast.success('Artikel gespeichert.');
			void load(true);
			return null;
		},
		[memberId, encodedShareCode, commit, load, togglingRef, toast],
	);
}
