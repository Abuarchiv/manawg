import { Card, CardContent } from '@/components/ui/card';
import { ItemContent, ItemEntry, ItemGroup } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslations } from 'next-intl';

const SKELETON_KEYS = ['s0', 's1', 's2'];

// Mirrors InventoryList: a group heading above one bordered card of rows.
export function ListSkeleton() {
	const t = useTranslations('inventory.skeleton');
	return (
		<div className="flex flex-col gap-2">
			<div className="flex h-5 items-center">
				<Skeleton className="h-3.5 w-24" />
			</div>
			<Card className="py-0">
				<CardContent className="p-0">
					<ItemGroup className="gap-0" aria-busy="true" aria-label={t('loadingAria')}>
						{SKELETON_KEYS.map((k) => (
							<ItemEntry key={k} className="px-3 py-3">
								<ItemContent className="flex-1 gap-2">
									<Skeleton className="h-3.5 w-2/5" />
									<Skeleton className="h-3 w-3/5" />
								</ItemContent>
							</ItemEntry>
						))}
					</ItemGroup>
				</CardContent>
			</Card>
		</div>
	);
}
