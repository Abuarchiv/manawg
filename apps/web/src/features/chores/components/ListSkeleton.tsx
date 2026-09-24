import { Item, ItemContent, ItemGroup, ItemMedia } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';

const SKELETON_KEYS = ['s0', 's1', 's2'];

// Mirrors ChoreRow: individually outlined rows in a gapped ItemGroup, not one boxed card.
export function ListSkeleton() {
	return (
		<ItemGroup aria-busy="true" aria-label="Putzplan wird geladen">
			{SKELETON_KEYS.map((k) => (
				<Item key={k} variant="outline">
					<ItemContent className="min-w-0 flex-1 space-y-2">
						<Skeleton className="h-[15px] w-2/3" />
						<div className="flex items-center gap-1.5">
							<Skeleton className="size-5 rounded-full" />
							<Skeleton className="h-3 w-1/4" />
							<Skeleton className="h-5 w-16 rounded-full" />
						</div>
					</ItemContent>
					<ItemMedia variant="icon" className="self-center">
						<Skeleton className="size-9 rounded-full" />
					</ItemMedia>
				</Item>
			))}
		</ItemGroup>
	);
}
