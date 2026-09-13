'use client';

import { Checkbox } from '@/components/animate-ui/components/base/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from '@/components/ui/drawer';
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { useConfirmDelete } from '@/core/hooks/useConfirmDelete';
import type { MemberInfo, ShoppingItem } from '@/features/shopping/components/shopping-types';
import { cn } from '@/shared/lib/cn';
import { MoreHorizontal, Receipt, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';

interface ShoppingItemRowProps {
	item: ShoppingItem;
	adder: MemberInfo;
	buyer: MemberInfo | null;
	isPending: (id: string) => boolean;
	onToggle: (item: ShoppingItem) => void;
	onRemove: (id: string) => void;
	removeError?: string | null;
	highlighted: boolean;
	shareCode: string;
	canRemove: boolean;
}

export const ShoppingItemRow = memo(function ShoppingItemRow({
	item,
	adder,
	buyer,
	isPending,
	onToggle,
	onRemove,
	removeError = null,
	highlighted,
	shareCode,
	canRemove,
}: ShoppingItemRowProps) {
	const isBought = item.boughtAt !== null;
	const pending = isPending(item.id);
	const deleteConfirm = useConfirmDelete();
	const isDeleteArmed = deleteConfirm.confirmId === item.id;
	const buyerName = item.boughtByMemberId ? buyer?.name : null;

	function handleDelete(): void {
		if (!deleteConfirm.request(item.id)) return;
		deleteConfirm.cancel();
		onRemove(item.id);
	}

	return (
		<Item
			data-shopping-row
			id={`shopping-${item.id}`}
			className={cn('scroll-mt-24 flex-nowrap', highlighted && 'ring-2 ring-inset ring-ring')}
			aria-busy={pending}
		>
			<ItemMedia className="size-11 self-center">
				<Checkbox
					checked={isBought}
					onCheckedChange={() => onToggle(item)}
					disabled={pending}
					size="lg"
					className="relative after:absolute after:-inset-2.5"
					aria-label={isBought ? `${item.name} wieder öffnen` : `${item.name} erledigen`}
				/>
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle
					className={cn(
						'line-clamp-none break-words [overflow-wrap:anywhere]',
						isBought && 'line-through',
					)}
				>
					{item.name}
				</ItemTitle>
				<ItemDescription className="line-clamp-none flex min-h-5 flex-wrap items-center gap-1 break-words">
					{item.quantity && <span>{item.quantity} · </span>}
					{pending ? (
						<output aria-live="polite" className="inline-flex items-center gap-1">
							<Spinner aria-hidden />
							Speichert…
						</output>
					) : isBought ? (
						buyerName ? (
							`Hinzugefügt von ${adder.name} · Gekauft von ${buyerName}`
						) : (
							`Hinzugefügt von ${adder.name} · Gekauft`
						)
					) : (
						`Hinzugefügt von ${adder.name}`
					)}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				<Drawer onOpenChange={() => deleteConfirm.cancel()}>
					<DrawerTrigger
						render={
							<Button
								variant="ghost"
								size="icon"
								className="size-11"
								aria-label={`Artikelaktionen: ${item.name}`}
							/>
						}
					>
						<MoreHorizontal aria-hidden />
					</DrawerTrigger>
					<DrawerContent className="mx-auto w-full max-w-md">
						<DrawerHeader>
							<DrawerTitle className="break-words">{item.name}</DrawerTitle>
							<DrawerDescription>{item.quantity || 'Keine Menge angegeben'}</DrawerDescription>
						</DrawerHeader>
						<div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
							<Badge variant="secondary" className="w-fit">
								{isBought ? 'Erledigt' : 'Offen'}
							</Badge>
							<p className="text-sm text-muted-foreground">
								Hinzugefügt von {adder.name}
								{isBought
									? buyerName
										? ` · Gekauft von ${buyerName}`
										: ' · Gekauft · Person nicht angegeben'
									: ''}
							</p>
							{isBought && (
								<>
									<Button
										nativeButton={false}
										render={
											<Link
												href={`/wg/${encodeURIComponent(shareCode)}/ausgaben?${new URLSearchParams({ desc: item.name, source: 'shopping', ...(item.boughtByMemberId ? { paidBy: item.boughtByMemberId } : {}) })}`}
											/>
										}
										className="min-h-11"
									>
										<Receipt data-icon="inline-start" aria-hidden />
										Als Ausgabe übernehmen
									</Button>
									<p className="text-sm text-muted-foreground">
										Nur dieser Artikel wird vorausgefüllt. Betrag und Aufteilung prüfst du vor dem
										Speichern.
									</p>
								</>
							)}
							{canRemove && isDeleteArmed && (
								<Alert>
									<AlertDescription>
										„{item.name}“ endgültig entfernen? Das lässt sich nicht rückgängig machen.
									</AlertDescription>
								</Alert>
							)}
							{removeError && (
								<Alert variant="destructive">
									<AlertDescription>{removeError}</AlertDescription>
								</Alert>
							)}
						</div>
						<DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
							{canRemove && (
								<Button
									type="button"
									variant="destructive"
									onClick={handleDelete}
									disabled={pending}
									className="min-h-11"
									aria-label={`${item.name} entfernen${isDeleteArmed ? ' bestätigen' : ''}`}
								>
									<Trash2 data-icon="inline-start" aria-hidden />
									{isDeleteArmed ? 'Endgültig entfernen' : 'Artikel entfernen'}
								</Button>
							)}
							{!canRemove && (
								<p className="text-sm text-muted-foreground">
									Nur die Person, die den Artikel hinzugefügt hat, kann ihn entfernen.
								</p>
							)}
							<DrawerClose render={<Button variant="outline" className="min-h-11" />}>
								Schließen
							</DrawerClose>
						</DrawerFooter>
					</DrawerContent>
				</Drawer>
			</ItemActions>
		</Item>
	);
});
