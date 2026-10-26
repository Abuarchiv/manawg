import { Item, ItemContent, ItemGroup, ItemMedia } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';

const SKELETON_KEYS = ['s0', 's1', 's2'];

// Mirrors the plan: a group heading above one divided, bordered ItemGroup of ChoreRow rows.
export function ListSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			<Skeleton className="h-3 w-24" />
			<ItemGroup
				aria-busy="true"
				aria-label="Putzplan wird geladen"
				className="gap-0 divide-y overflow-hidden rounded-xl border"
			>
				{SKELETON_KEYS.map((k) => (
					<Item key={k} className="rounded-none py-2 pr-1.5">
						<Skeleton className="size-7 shrink-0 rounded-full" />
						<ItemContent className="min-w-0 flex-1 gap-1.5">
							<Skeleton className="h-3.5 w-2/3" />
							<Skeleton className="h-3 w-1/3" />
						</ItemContent>
						<ItemMedia variant="icon" className="gap-3 self-center">
							<Skeleton className="size-8 rounded-full" />
							<Skeleton className="size-8 rounded-full" />
						</ItemMedia>
					</Item>
				))}
			</ItemGroup>
		</div>
	);
}
