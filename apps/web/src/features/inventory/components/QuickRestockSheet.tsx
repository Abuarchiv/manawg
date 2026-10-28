'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/components/ui/drawer';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import {
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemEntry,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import {
	type InventoryItemDto,
	type InventoryMutationItemDto,
	quickRestockCandidates,
	restockAmount,
} from '@/features/inventory/inventory';
import { restockItem } from '@/features/inventory/restock-request';
import { useQuantityText } from '@/features/inventory/use-quantity-text';
import type { Locale } from '@/shared/i18n/locale';
import { type Message, useMessage } from '@/shared/i18n/message';
import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

interface QuickRestockSheetProps {
	open: boolean;
	items: InventoryItemDto[];
	shareCode: string;
	memberId: string;
	onClose: () => void;
	onChanged: (item?: InventoryMutationItemDto, deletedId?: string) => void;
}

export function QuickRestockSheet({
	open,
	items,
	shareCode,
	memberId,
	onClose,
	onChanged,
}: QuickRestockSheetProps) {
	const t = useTranslations('inventory.quick');
	const tRow = useTranslations('inventory.row');
	const render = useMessage();
	const quantityText = useQuantityText();
	const locale = useLocale() as Locale;
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [error, setError] = useState<Message | null>(null);
	const restockRequestKeysRef = useRef(new Map<string, string>());

	// The row order is frozen while the sheet is open (quantities stay live), so rows do not jump after a tap.
	const [order, setOrder] = useState<string[] | null>(null);
	if (open && order === null)
		setOrder(quickRestockCandidates(items, locale).map((item) => item.id));
	else if (!open && order !== null) setOrder(null);
	const sorted = (order ?? []).flatMap((id) => items.find((item) => item.id === id) ?? []);

	async function quickRestock(item: InventoryItemDto): Promise<void> {
		if (pendingId !== null) return;
		setPendingId(item.id);
		setError(null);
		const outcome = await restockItem({
			shareCode,
			memberId,
			item,
			keys: restockRequestKeysRef.current,
		});
		setPendingId(null);
		if (outcome.kind === 'ok') {
			onChanged(outcome.item);
		} else if (outcome.kind === 'gone') {
			onChanged(undefined, item.id);
			setError({ key: 'inventory.quick.gone', values: { name: item.name } });
		} else {
			setError(outcome.message);
		}
	}

	return (
		<Drawer
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					setError(null);
					onClose();
				}
			}}
		>
			<DrawerContent className="mx-auto w-full max-w-md">
				<DrawerHeader>
					<DrawerTitle>{t('title')}</DrawerTitle>
					<DrawerDescription>{t('description')}</DrawerDescription>
				</DrawerHeader>
				<div
					className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4"
					style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
				>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{render(error)}
						</p>
					)}
					{sorted.length === 0 ? (
						<Empty className="border border-dashed">
							<EmptyHeader>
								<EmptyTitle>{t('emptyTitle')}</EmptyTitle>
								<EmptyDescription>{t('emptyDescription')}</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<Card className="py-0">
							<CardContent className="p-0">
								<ItemGroup className="gap-0 divide-y divide-border">
									{sorted.map((item) => {
										const amount = restockAmount(item);
										return (
											<ItemEntry key={item.id} className="px-3 py-2.5 not-last:border-b-border">
												{/* min-w instead of min-w-0: at large font sizes the button wraps below the text
											    instead of squeezing the name character by character. */}
												<ItemContent className="min-w-[10ch] flex-1">
													<ItemTitle className="w-full min-w-0 line-clamp-none [overflow-wrap:break-word]">
														<span className="min-w-0 flex-1 break-words hyphens-auto text-sm font-medium">
															{item.name}
														</span>
													</ItemTitle>
													<ItemDescription className="line-clamp-none text-xs tabular-nums [overflow-wrap:break-word]">
														{t('usage', {
															quantity: quantityText(item.quantity, item.unit),
															count: item.decrementCount30d,
														})}
													</ItemDescription>
												</ItemContent>
												<ItemActions className="shrink-0">
													<Button
														type="button"
														variant="outline"
														size={amount === 1 ? 'icon' : 'sm'}
														onClick={() => void quickRestock(item)}
														disabled={pendingId !== null}
														focusableWhenDisabled
														className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
														aria-busy={pendingId === item.id}
														aria-label={
															amount === 1
																? tRow('increaseAria', { name: item.name })
																: t('increaseByAria', {
																		name: item.name,
																		amount: quantityText(amount, item.unit),
																	})
														}
													>
														{pendingId === item.id ? <Spinner aria-hidden /> : <Plus aria-hidden />}
														{pendingId !== item.id && amount > 1 && (
															<span className="tabular-nums">
																{quantityText(amount, item.unit)}
															</span>
														)}
													</Button>
												</ItemActions>
											</ItemEntry>
										);
									})}
								</ItemGroup>
							</CardContent>
						</Card>
					)}
				</div>
				<DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
					<DrawerClose render={<Button variant="outline" />}>{t('close')}</DrawerClose>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
}
