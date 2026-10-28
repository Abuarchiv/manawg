'use client';

import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
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
	formatQuantity,
	type InventoryItemDto,
	type InventoryMutationItemDto,
	quickRestockCandidates,
	restockAmount,
} from '@/features/inventory/inventory';
import { restockItem } from '@/features/inventory/restock-request';

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
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const restockRequestKeysRef = useRef(new Map<string, string>());

	// The row order is frozen while the sheet is open (quantities stay live), so rows do not jump after a tap.
	const [order, setOrder] = useState<string[] | null>(null);
	if (open && order === null) setOrder(quickRestockCandidates(items).map((item) => item.id));
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
			setError(`${item.name} existiert nicht mehr und wurde aus der Liste entfernt.`);
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
					<DrawerTitle>Schnell nachfüllen</DrawerTitle>
					<DrawerDescription>
						Fast leere Vorräte zuerst, dann die am häufigsten verbrauchten der letzten 30 Tage.
					</DrawerDescription>
				</DrawerHeader>
				<div
					className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4"
					style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
				>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
					{sorted.length === 0 ? (
						<Empty className="border border-dashed">
							<EmptyHeader>
								<EmptyTitle>Noch keine Verbrauchsdaten</EmptyTitle>
								<EmptyDescription>
									Sobald Vorräte verbraucht werden, erscheinen hier Vorschläge.
								</EmptyDescription>
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
														{formatQuantity(item.quantity, item.unit)} · {item.decrementCount30d}×
														in 30 Tagen
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
																? `${item.name} um eins erhöhen`
																: `${item.name} um ${formatQuantity(amount, item.unit)} erhöhen`
														}
													>
														{pendingId === item.id ? <Spinner aria-hidden /> : <Plus aria-hidden />}
														{pendingId !== item.id && amount > 1 && (
															<span className="tabular-nums">
																{formatQuantity(amount, item.unit)}
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
					<DrawerClose render={<Button variant="outline" />}>Schließen</DrawerClose>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
}
