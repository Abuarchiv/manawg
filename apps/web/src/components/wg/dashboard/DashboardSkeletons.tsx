const BALANCE_SKELETON_KEYS = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
const CHORE_SKELETON_KEYS = ['c0', 'c1', 'c2'];
const ACTIVITY_SKELETON_KEYS = ['a0', 'a1', 'a2', 'a3'];

export function BalanceSkeleton({ count }: { count: number }) {
	const keys = BALANCE_SKELETON_KEYS.slice(
		0,
		Math.min(Math.max(count, 2), BALANCE_SKELETON_KEYS.length),
	);
	return (
		<ul className="divide-y divide-[var(--border)]">
			{keys.map((k) => (
				<li key={k} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
					<div className="flex flex-1 items-center gap-2.5">
						<span className="h-6 w-6 animate-pulse rounded-full bg-[var(--surface-strong)]" />
						<span className="h-3 w-32 animate-pulse rounded bg-[var(--surface-strong)]" />
					</div>
					<span className="h-3 w-16 animate-pulse rounded bg-[var(--surface-strong)]" />
				</li>
			))}
		</ul>
	);
}

export function ChoreSkeleton() {
	return (
		<ul className="divide-y divide-[var(--border)]">
			{CHORE_SKELETON_KEYS.map((k) => (
				<li key={k} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
					<span className="h-7 w-7 animate-pulse rounded-full bg-[var(--surface-strong)]" />
					<span className="h-3 flex-1 animate-pulse rounded bg-[var(--surface-strong)]" />
					<span className="h-3 w-14 animate-pulse rounded bg-[var(--surface-strong)]" />
				</li>
			))}
		</ul>
	);
}

export function ActivitySkeleton() {
	return (
		<ol className="divide-y divide-[var(--border)]">
			{ACTIVITY_SKELETON_KEYS.map((k) => (
				<li key={k} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
					<span className="mt-0.5 h-4 w-4 animate-pulse rounded bg-[var(--surface-strong)]" />
					<div className="flex-1 space-y-2">
						<span className="block h-3 w-3/4 animate-pulse rounded bg-[var(--surface-strong)]" />
					</div>
				</li>
			))}
		</ol>
	);
}
