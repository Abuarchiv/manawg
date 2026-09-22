'use client';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { ItemGroup } from '@/components/ui/item';
import { InventoryAddModal } from '@/features/inventory/components/InventoryAddModal';
import { InventoryItemRow } from '@/features/inventory/components/InventoryItemRow';
import { QuickRestockSheet } from '@/features/inventory/components/QuickRestockSheet';
import {
	INVENTORY_CATEGORIES,
	INVENTORY_CATEGORY_LABELS,
	type InventoryCategory,
	type InventoryItemDto,
	groupItemsByCategory,
	isBelowThreshold,
} from '@/features/inventory/inventory';
import { cn } from '@/shared/lib/cn';
import { Package, Plus, ShoppingBasket, Zap } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

interface InventoryListProps {
	items: InventoryItemDto[];
	shareCode: string;
	memberId: string;
	memberToken?: string | undefined;
	onChanged: () => void;
}

export function InventoryList({
	items,
	shareCode,
	memberId,
	memberToken,
	onChanged,
}: InventoryListProps) {
	const [addOpen, setAddOpen] = useState(false);
	const [quickOpen, setQuickOpen] = useState(false);
	const [editing, setEditing] = useState<InventoryItemDto | null>(null);
	// Knappe Vorräte stehen gesammelt oben, der Rest bleibt nach Kategorie sortiert.
	const lowItems = useMemo(() => items.filter(isBelowThreshold), [items]);
	const grouped = useMemo(
		() => groupItemsByCategory(items.filter((item) => !isBelowThreshold(item))),
		[items],
	);
	const isEmpty = items.length === 0;
	const hasQuickRestockItems = items.some(
		(item) => item.decrementCount30d > 0 || item.lastDecrementedAt !== null,
	);

	function openEdit(item: InventoryItemDto): void {
		setEditing(item);
	}

	return (
		<div className="flex flex-col gap-4">
			{!isEmpty && (
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						onClick={() => setAddOpen(true)}
						className="h-auto min-h-11 w-full max-w-full whitespace-normal sm:w-auto"
					>
						<Plus data-icon="inline-start" aria-hidden />
						Vorrat hinzufügen
					</Button>
					{hasQuickRestockItems && (
						<Button
							type="button"
							variant="outline"
							onClick={() => setQuickOpen(true)}
							className="h-auto min-h-11 w-full max-w-full whitespace-normal sm:w-auto"
						>
							<Zap data-icon="inline-start" aria-hidden />
							Schnell nachfüllen
						</Button>
					)}
				</div>
			)}
			{isEmpty ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Package aria-hidden />
						</EmptyMedia>
						<EmptyTitle>Noch keine Vorräte erfasst</EmptyTitle>
						<EmptyDescription>Beginne mit Klopapier, Spülmittel oder Nudeln.</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button type="button" onClick={() => setAddOpen(true)} className="min-h-11">
							<Plus aria-hidden />
							Ersten Vorrat anlegen
						</Button>
					</EmptyContent>
				</Empty>
			) : (
				<div className="flex flex-col gap-4">
					{lowItems.length > 0 && (
						<section aria-labelledby="inventory-low" className="flex flex-col gap-2">
							<h2
								id="inventory-low"
								className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
							>
								Bald leer
								<Badge variant="secondary" className="tabular-nums">
									{lowItems.length}
								</Badge>
							</h2>
							<Card className="py-0">
								<CardContent className="p-0">
									<ItemGroup className="gap-0 divide-y divide-border">
										{lowItems.map((item) => (
											<InventoryItemRow
												key={item.id}
												item={item}
												shareCode={shareCode}
												memberId={memberId}
												memberToken={memberToken}
												onChanged={onChanged}
												onEdit={openEdit}
											/>
										))}
									</ItemGroup>
								</CardContent>
							</Card>
							<Link
								href={`/wg/${encodeURIComponent(shareCode)}/einkauf`}
								className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 self-start')}
							>
								<ShoppingBasket data-icon="inline-start" aria-hidden />
								Einkaufsliste öffnen
							</Link>
						</section>
					)}
					{INVENTORY_CATEGORIES.filter(
						(category): category is InventoryCategory => grouped[category].length > 0,
					).map((category) => (
						<section
							key={category}
							aria-labelledby={`inventory-${category}`}
							className="flex flex-col gap-2"
						>
							<h2
								id={`inventory-${category}`}
								className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
							>
								{INVENTORY_CATEGORY_LABELS[category]}
								<Badge variant="secondary" className="tabular-nums">
									{grouped[category].length}
								</Badge>
							</h2>
							<Card className="py-0">
								<CardContent className="p-0">
									<ItemGroup className="gap-0 divide-y divide-border">
										{grouped[category].map((item) => (
											<InventoryItemRow
												key={item.id}
												item={item}
												shareCode={shareCode}
												memberId={memberId}
												memberToken={memberToken}
												onChanged={onChanged}
												onEdit={openEdit}
											/>
										))}
									</ItemGroup>
								</CardContent>
							</Card>
						</section>
					))}
				</div>
			)}

			<InventoryAddModal
				open={addOpen || editing !== null}
				shareCode={shareCode}
				memberId={memberId}
				memberToken={memberToken}
				mode={editing ? 'edit' : 'create'}
				initial={editing}
				onClose={() => {
					setAddOpen(false);
					setEditing(null);
				}}
				onSaved={onChanged}
			/>
			<QuickRestockSheet
				open={quickOpen}
				items={items}
				shareCode={shareCode}
				memberId={memberId}
				memberToken={memberToken}
				onClose={() => setQuickOpen(false)}
				onChanged={onChanged}
			/>
		</div>
	);
}
