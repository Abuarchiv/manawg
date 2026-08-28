import { LIST_CARD } from '@/components/ui/styles';

const SKELETON_KEYS = ['s0', 's1', 's2', 's3'];

export function ListSkeleton() {
	return (
		<ul className={LIST_CARD}>
			{SKELETON_KEYS.map((k) => (
				<li key={k} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
					{/* Matches real row: h-11 w-11 toggle button */}
					<span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-[var(--surface-strong)]" />
					<div className="flex-1 space-y-1.5">
						{/* Name line */}
						<span className="block h-3 w-3/5 animate-pulse rounded bg-[var(--surface-strong)]" />
						{/* Meta line */}
						<span className="block h-2.5 w-2/5 animate-pulse rounded bg-[var(--surface-strong)]" />
					</div>
				</li>
			))}
		</ul>
	);
}
