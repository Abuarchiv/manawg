'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
	type InventoryItemDto,
	boughtRestockMatches,
	restockAmount,
} from '@/features/inventory/inventory';
import { restockItem } from '@/features/inventory/restock-request';
import { useQuantityText } from '@/features/inventory/use-quantity-text';
import { type Message, useMessage } from '@/shared/i18n/message';
import { PackagePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

const MAX_ROWS = 3;
// "Nicht jetzt" covers this shopping trip; the next purchase of the item asks again.
const DISMISS_MS = 24 * 60 * 60 * 1000;

/**
 * After shopping: scarce stock whose name was just ticked off (by the caller) is still low, because
 * buying does not raise it. Offers to raise it by the amount the shopping entry asked for.
 * The caller passes only the member's own recent purchases, so two housemates never both restock.
 */
export function InventoryRestockPrompt({
	items,
	boughtNames,
	shareCode,
	memberId,
	onRestocked,
}: {
	items: InventoryItemDto[];
	boughtNames: string[];
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
	const storageKey = (id: string): string => `manawg:restock-prompt:${shareCode}:${id}`;

	const matches = boughtRestockMatches(items, boughtNames);
	const matchIds = matches.map((item) => item.id).join(',');
	// biome-ignore lint/correctness/useExhaustiveDependencies: storageKey only depends on shareCode
	useEffect(() => {
		const dismissed = matchIds.split(',').filter((id) => {
			try {
				const dismissedAt = Date.parse(window.localStorage.getItem(storageKey(id)) ?? '');
				return id !== '' && Date.now() - dismissedAt < DISMISS_MS;
			} catch {
				return false;
			}
		});
		if (dismissed.length > 0) setHidden((prev) => new Set([...prev, ...dismissed]));
	}, [matchIds, shareCode]);

	const visible = matches.filter((item) => !hidden.has(item.id)).slice(0, MAX_ROWS);
	if (visible.length === 0) return null;

	function hide(id: string): void {
		setHidden((prev) => new Set([...prev, id]));
	}

	function dismiss(id: string): void {
		hide(id);
		try {
			window.localStorage.setItem(storageKey(id), new Date().toISOString());
		} catch {
			// The notice is then hidden for this session only.
		}
	}

	async function restock(item: InventoryItemDto): Promise<void> {
		if (pendingId !== null) return;
		setPendingId(item.id);
		setError(null);
		const outcome = await restockItem({ shareCode, memberId, item, keys: keysRef.current });
		setPendingId(null);
		if (outcome.kind === 'error') {
			setError(outcome.message);
			return;
		}
		hide(item.id);
		onRestocked();
	}

	return (
		<Alert>
			<PackagePlus aria-hidden />
			<AlertDescription className="flex flex-col gap-2 text-xs">
				{visible.map((item) => (
					<span key={item.id} className="flex flex-col gap-2">
						<span>
							{t('question', {
								name: item.name,
								amount: quantityText(restockAmount(item), item.unit),
							})}
						</span>
						<span className="flex flex-wrap gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => void restock(item)}
								disabled={pendingId !== null}
								focusableWhenDisabled
								aria-busy={pendingId === item.id}
								aria-label={t('restockAria', { name: item.name })}
							>
								{pendingId === item.id && <Spinner aria-hidden />}
								{t('restock')}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => dismiss(item.id)}
								aria-label={t('dismissAria', { name: item.name })}
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
