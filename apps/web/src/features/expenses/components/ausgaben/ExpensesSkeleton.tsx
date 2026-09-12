import { Item, ItemContent, ItemGroup } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';

export function ExpensesSkeleton() {
	return (
		<ItemGroup aria-busy="true" aria-label="Ausgaben werden geladen">
			{['s0', 's1', 's2', 's3'].map((key) => (
				<Item key={key} variant="outline" aria-hidden="true">
					<ItemContent>
						<Skeleton className="h-4 w-2/3" />
						<Skeleton className="h-3 w-1/2" />
					</ItemContent>
					<Skeleton className="h-4 w-20" />
				</Item>
			))}
		</ItemGroup>
	);
}
