import { Skeleton } from '@/components/ui/skeleton';

const BALANCE_SKELETON_KEYS = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
const CHORE_SKELETON_KEYS = ['c0', 'c1', 'c2'];
const ACTIVITY_SKELETON_KEYS = ['a0', 'a1', 'a2', 'a3'];

export function BalanceSkeleton({ count }: { count: number }) {
	const keys = BALANCE_SKELETON_KEYS.slice(
		0,
		Math.min(Math.max(count, 2), BALANCE_SKELETON_KEYS.length),
	);
	return (
		<ul aria-label="Salden werden geladen" aria-busy="true" className="flex flex-col gap-4">
			{keys.map((key) => (
				<li key={key} className="flex items-center gap-3">
					<Skeleton className="size-8 rounded-full" />
					<Skeleton className="h-4 flex-1" />
					<Skeleton className="h-4 w-16" />
				</li>
			))}
		</ul>
	);
}
export function ChoreSkeleton() {
	return (
		<ul aria-label="Aufgaben werden geladen" aria-busy="true" className="flex flex-col gap-4">
			{CHORE_SKELETON_KEYS.map((key) => (
				<li key={key} className="flex items-center gap-3">
					<Skeleton className="size-8 rounded-full" />
					<Skeleton className="h-4 flex-1" />
					<Skeleton className="h-4 w-14" />
				</li>
			))}
		</ul>
	);
}
export function ActivitySkeleton() {
	return (
		<ol aria-label="Aktivitäten werden geladen" aria-busy="true" className="flex flex-col gap-4">
			{ACTIVITY_SKELETON_KEYS.map((key) => (
				<li key={key} className="flex items-start gap-3">
					<Skeleton className="size-4" />
					<div className="flex flex-1 flex-col gap-2">
						<Skeleton className="h-4 w-3/4" />
						<Skeleton className="h-3 w-1/3" />
					</div>
				</li>
			))}
		</ol>
	);
}
