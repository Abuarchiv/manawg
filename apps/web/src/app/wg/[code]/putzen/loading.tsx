import { Skeleton } from '@/components/ui/skeleton';
import { ListSkeleton } from '@/features/chores/components/ListSkeleton';

export default function Loading() {
	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3">
			<Skeleton aria-hidden className="h-9 w-full rounded-lg" />
			<ListSkeleton />
		</div>
	);
}
