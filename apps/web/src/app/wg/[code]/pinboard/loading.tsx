import { Skeleton } from '@/components/ui/skeleton';
import { AnnouncementSkeleton } from '@/features/announcements/components/AnnouncementSkeleton';

export default function Loading() {
	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3">
			<Skeleton aria-hidden className="h-9 w-full rounded-lg" />
			<AnnouncementSkeleton />
		</div>
	);
}
