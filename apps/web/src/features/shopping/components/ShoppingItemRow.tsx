'use client';

import { Check, MoreHorizontal, Pencil, Receipt, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { memo, useEffect, useRef, useState } from 'react';
import { Checkbox } from '@/components/animate-ui/components/base/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { useWg } from '@/components/wg/WgContextProvider';
import { useConfirmDelete } from '@/core/hooks/use-confirm-delete';
import { ShoppingEditForm } from '@/features/shopping/components/ShoppingEditForm';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import type { EditShoppingItem } from '@/features/shopping/hooks/use-shopping-edit';
import { expensePrefillHref } from '@/features/shopping/shopping-view';
import { type Message, useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';
import type { MemberInfo } from '@/shared/lib/member-types';

// From this swipe distance to the right, the item counts as checked off (or open again).
const SWIPE_TOGGLE_PX = 72;
// The row follows the finger only this far.
const SWIPE_MAX_PX = 120;

interface ShoppingItemRowProps {
	item: ShoppingItem;
	adder: MemberInfo;
	buyer: MemberInfo | null;
	pending: boolean;
	queued?: boolean;
	onToggle: (item: ShoppingItem) => void;
	onRemove: (id: string, itemName: string) => void;
	onEdit: EditShoppingItem;
	removeError?: Message | null;
	highlighted: boolean;
	shareCode: string;
	canRemove: boolean;
}

export const ShoppingItemRow = memo(function ShoppingItemRow({
	item,
	adder,
	buyer,
	pending,
	queued = false,
	onToggle,
	onRemove,
	onEdit,
	removeError = null,
	highlighted,
	shareCode,
	canRemove,
}: ShoppingItemRowProps) {
	const t = useTranslations('shopping.row');
	const render = useMessage();
	const isBought = item.boughtAt !== null;
	const deleteConfirm = useConfirmDelete();
	const isDeleteArmed = deleteConfirm.confirmId === item.id;
	const { identity } = useWg();
	// The own person is addressed as "you", not by their own name.
	const boughtBySelf = item.boughtByMemberId === identity.memberId;
	const buyerKnown = Boolean(item.boughtByMemberId) && (boughtBySelf || Boolean(buyer?.name));
	const boughtByText = t('boughtBy', {
		who: boughtBySelf ? 'self' : 'other',
		name: buyer?.name ?? '',
	});
	const addedBy = {
		who: item.addedByMemberId === identity.memberId ? 'self' : 'other',
		name: adder.name,
	};
	const swipeStartX = useRef<number | null>(null);
	const confirmAlertRef = useRef<HTMLDivElement>(null);
	const editButtonRef = useRef<HTMLButtonElement>(null);
	const wasEditingRef = useRef(false);
	const [swipeX, setSwipeX] = useState(0);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [editing, setEditing] = useState(false);

	// With large text the notice pushes the area over the close bar: bring it into view.
	useEffect(() => {
		if (isDeleteArmed) confirmAlertRef.current?.scrollIntoView({ block: 'nearest' });
	}, [isDeleteArmed]);

	// The form replaces the button: give focus back when it closes (no-op once the drawer is gone).
	useEffect(() => {
		if (!editing && wasEditingRef.current) editButtonRef.current?.focus();
		wasEditingRef.current = editing;
	}, [editing]);

	function endSwipe(): void {
		if (swipeStartX.current !== null && swipeX >= SWIPE_TOGGLE_PX && !pending && !queued) {
			onToggle(item);
		}
		swipeStartX.current = null;
		setSwipeX(0);
	}

	function handleDelete(): void {
		if (!deleteConfirm.request(item.id)) return;
		deleteConfirm.cancel();
		onRemove(item.id, item.name);
	}

	return (
		<li className={cn('relative', swipeX > 0 && 'overflow-hidden')}>
			{/* overflow-hidden only during an active swipe: otherwise it clips the checkbox's
			    invisible tap area (after:-inset-2.5) at the left edge, because the item has
			    px-0 here and the checkbox sits flush. */}
			<div
				aria-hidden
				className={cn(
					'absolute inset-0 flex items-center gap-2 bg-muted px-4 text-sm font-medium',
					swipeX === 0 && 'invisible',
				)}
			>
				{isBought ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
				{isBought ? t('swipeReopen') : t('swipeBought')}
			</div>
			<Item
				data-shopping-row
				id={`shopping-${item.id}`}
				className={cn(
					'relative touch-pan-y scroll-mt-24 rounded-none bg-background py-1 pr-1.5 pl-3',
					swipeX === 0 && 'transition-transform',
					highlighted && 'ring-2 ring-inset ring-ring',
				)}
				style={swipeX > 0 ? { transform: `translateX(${swipeX}px)` } : undefined}
				aria-busy={pending}
				onPointerDown={(event) => {
					// The mouse stays on click; swiping is a touch gesture.
					if (event.pointerType !== 'mouse' && !pending && !queued) {
						swipeStartX.current = event.clientX;
						// Without capture, pointermove/-up would be redirected to a neighboring element
						// on a fast swipe and the row would stay visually stuck.
						event.currentTarget.setPointerCapture(event.pointerId);
					}
				}}
				onPointerMove={(event) => {
					if (swipeStartX.current === null) return;
					setSwipeX(Math.min(Math.max(0, event.clientX - swipeStartX.current), SWIPE_MAX_PX));
				}}
				onPointerUp={endSwipe}
				onPointerCancel={() => {
					swipeStartX.current = null;
					setSwipeX(0);
				}}
			>
				<ItemMedia className="size-auto self-center">
					<Checkbox
						checked={isBought}
						onCheckedChange={() => onToggle(item)}
						disabled={pending || queued}
						size="lg"
						className="relative size-6 rounded-md border-foreground/50 after:absolute after:-inset-2.5 [&_svg]:size-3.5"
						aria-label={
							isBought
								? t('checkReopenAria', { name: item.name })
								: t('checkCompleteAria', { name: item.name })
						}
					/>
				</ItemMedia>
				{/* basis-0 + min-w instead of basis-32: with large text check mark, text and ⋯ stay in one row;
				    the ⋯ only drops below when a word would otherwise break mid-word. */}
				<ItemContent className="min-w-[10ch] basis-0 gap-0.5">
					<ItemTitle
						className={cn(
							'block line-clamp-none [overflow-wrap:break-word]',
							isBought && 'text-muted-foreground line-through',
						)}
					>
						{item.name}
					</ItemTitle>
					<ItemDescription className="line-clamp-1">
						{pending ? (
							<output aria-live="polite" className="flex items-center gap-1">
								<Spinner aria-hidden className="size-3" />
								{t('saving')}
							</output>
						) : queued ? (
							<output aria-live="polite">{t('waitingToSync')}</output>
						) : (
							[
								item.quantity,
								isBought ? (buyerKnown ? boughtByText : t('bought')) : t('addedByShort', addedBy),
							]
								.filter(Boolean)
								.join(' · ')
						)}
					</ItemDescription>
				</ItemContent>
				<ItemActions className="ml-auto">
					<Drawer
						open={drawerOpen}
						onOpenChange={(open) => {
							setDrawerOpen(open);
							setEditing(false);
							deleteConfirm.cancel();
						}}
					>
						<DrawerTrigger
							render={
								<Button
									variant="ghost"
									size="icon"
									aria-label={t('actionsAria', { name: item.name })}
								/>
							}
						>
							<MoreHorizontal aria-hidden />
						</DrawerTrigger>
						<DrawerContent className="mx-auto w-full max-w-md">
							<DrawerHeader>
								<DrawerTitle className="break-words">{item.name}</DrawerTitle>
								<DrawerDescription>
									{[
										item.quantity,
										t('addedBy', addedBy),
										isBought ? (buyerKnown ? boughtByText : t('boughtUnknown')) : null,
									]
										.filter(Boolean)
										.join(' · ')}
								</DrawerDescription>
							</DrawerHeader>
							<div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
								{editing ? (
									<ShoppingEditForm
										item={item}
										onSave={async (base, fields) => {
											const message = await onEdit(base, fields);
											// Saved: back to the list, like the other modules.
											if (message === null) setDrawerOpen(false);
											return message;
										}}
										onDone={() => setEditing(false)}
									/>
								) : (
									<Button
										ref={editButtonRef}
										type="button"
										variant="outline"
										onClick={() => setEditing(true)}
									>
										<Pencil data-icon="inline-start" aria-hidden />
										{t('edit')}
									</Button>
								)}
								{isBought && (
									<>
										<Button
											nativeButton={false}
											render={
												<Link
													href={expensePrefillHref(shareCode, {
														desc: item.name,
														source: 'shopping',
														...(item.boughtByMemberId ? { paidBy: item.boughtByMemberId } : {}),
													})}
												/>
											}
										>
											<Receipt data-icon="inline-start" aria-hidden />
											{t('addAsExpense')}
										</Button>
										<p className="text-sm text-muted-foreground">{t('expenseHint')}</p>
									</>
								)}
								{canRemove && isDeleteArmed && (
									<Alert ref={confirmAlertRef}>
										<AlertDescription>{t('removeConfirm', { name: item.name })}</AlertDescription>
									</Alert>
								)}
								{removeError && (
									<Alert variant="destructive">
										<AlertDescription>{render(removeError)}</AlertDescription>
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
										aria-label={
											isDeleteArmed
												? t('removeFinalAria', { name: item.name })
												: t('removeAria', { name: item.name })
										}
									>
										<Trash2 data-icon="inline-start" aria-hidden />
										{isDeleteArmed ? t('removeFinal') : t('remove')}
									</Button>
								)}
								{!canRemove && <p className="text-sm text-muted-foreground">{t('cannotRemove')}</p>}
								<DrawerClose render={<Button variant="outline" />}>{t('close')}</DrawerClose>
							</DrawerFooter>
						</DrawerContent>
					</Drawer>
				</ItemActions>
			</Item>
		</li>
	);
});
