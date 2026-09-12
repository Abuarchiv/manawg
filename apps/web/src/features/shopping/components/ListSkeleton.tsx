import { Item, ItemContent, ItemGroup, ItemMedia } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';

const SKELETON_KEYS = ['s0', 's1', 's2', 's3'];

export function ListSkeleton() {
	return (
		<ItemGroup
			aria-busy="true"
			aria-label="Einkaufsliste wird geladen"
			className="overflow-hidden rounded-xl border border-border bg-card"
		>
			{SKELETON_KEYS.map((k) => (
				<Item key={k} className="px-3 py-2.5 sm:px-4">
					<ItemMedia variant="icon" className="self-center">
						<Skeleton className="size-6 rounded-md" />
					</ItemMedia>
					<ItemContent className="flex-1 space-y-1.5">
						{/* Name line */}
						<Skeleton className="h-3.5 w-3/5" />
						{/* Meta line */}
						<Skeleton className="h-3 w-2/5" />
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}
