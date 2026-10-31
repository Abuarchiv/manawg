'use client';

import { PackagePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
	boughtRestockMatches,
	type InventoryItemDto,
	type RestockPurchase,
	restockAmount,
} from '@/features/inventory/inventory';
import { restockItem } from '@/features/inventory/restock-request';
import { useQuantityText } from '@/features/inventory/use-quantity-text';
import { type Message, useMessage } from '@/shared/i18n/message';

const MAX_ROWS = 3;
const DISMISS_MS = 24 * 60 * 60 * 1000;

type RestockMatch = { item: InventoryItemDto; purchase: RestockPurchase; id: string };

/**
 * After shopping: scarce stock whose name was just ticked off (by the caller) is still low, because
 * buying does not raise it. Offers to lift it above its threshold once per purchase.
 * The caller passes only the member's own recent purchases, so two housemates never both restock.
 */
export function InventoryRestockPrompt({
	items,
	purchases,
	shareCode,
	memberId,
	onRestocked,
}: {
	items: InventoryItemDto[];
	purchases: RestockPurchase[];
	shareCode: string;
	memberId: string;
	onRestocked: () => void;
}) {
	const t = useTranslations('inventory.restockPrompt');
	const render = useMessage();
	const quantityText = useQuantityText();
	const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [error, setError] = useState<Message | null>(null);
	const keysRef = useRef(new Map<string, string>());
	const storagePrefix = `manawg:restock-prompt:${shareCode}:${memberId}:`;

	const matches = boughtRestockMatches(items, purchases).map(({ item, purchase }) => ({
		item,
		purchase,
		id: `${item.id}:${purchase.id}:${purchase.boughtAt}`,
	}));
	const matchIds = matches.map((match) => match.id).join(',');
	useEffect(() => {
		const dismissed = matchIds.split(',').filter((id) => {
			try {
				const handledAt = Date.parse(window.localStorage.getItem(`${storagePrefix}${id}`) ?? '');
				return id !== '' && Date.now() - handledAt < DISMISS_MS;
			} catch {
				return false;
			}
		});
		if (dismissed.length > 0) setHidden((prev) => new Set([...prev, ...dismissed]));
	}, [matchIds, storagePrefix]);

	const visible = matches.filter((match) => !hidden.has(match.id)).slice(0, MAX_ROWS);
	if (visible.length === 0) return null;

	function hide(id: string): void {
		setHidden((prev) => new Set([...prev, id]));
	}

	function dismiss(match: RestockMatch): void {
		hide(match.id);
		try {
			for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
				const key = window.localStorage.key(index);
				if (key?.startsWith(storagePrefix)) {
					const handledAt = Date.parse(window.localStorage.getItem(key) ?? '');
					if (!Number.isFinite(handledAt) || Date.now() - handledAt >= DISMISS_MS) {
						window.localStorage.removeItem(key);
					}
				}
			}
			window.localStorage.setItem(`${storagePrefix}${match.id}`, new Date().toISOString());
		} catch {
			// The notice is then hidden for this session only.
		}
	}

	async function restock(match: RestockMatch): Promise<void> {
		if (pendingId !== null) return;
		const { item, purchase } = match;
		setPendingId(item.id);
		setError(null);
		const outcome = await restockItem({
			shareCode,
			memberId,
			item,
			keys: keysRef.current,
			purchase: { id: purchase.id, boughtAt: purchase.boughtAt },
		});
		setPendingId(null);
		if (outcome.kind === 'error') {
			setError(outcome.message);
			return;
		}
		dismiss(match);
		onRestocked();
	}

	return (
		<Alert>
			<PackagePlus aria-hidden />
			<AlertDescription className="flex flex-col gap-2 text-xs">
				{visible.map((match) => (
					<span key={match.id} className="flex flex-col gap-2">
						<span>
							{t('question', {
								name: match.item.name,
								amount: quantityText(restockAmount(match.item), match.item.unit),
							})}
						</span>
						<span className="flex flex-wrap gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => void restock(match)}
								disabled={pendingId !== null}
								focusableWhenDisabled
								aria-busy={pendingId === match.item.id}
								aria-label={t('restockAria', { name: match.item.name })}
							>
								{pendingId === match.item.id && <Spinner aria-hidden />}
								{t('restock')}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => dismiss(match)}
								aria-label={t('dismissAria', { name: match.item.name })}
							>
								{t('dismiss')}
							</Button>
						</span>
					</span>
				))}
				{error && (
					<span role="alert" className="text-xs text-destructive">
						{render(error)}
					</span>
				)}
			</AlertDescription>
		</Alert>
	);
}
