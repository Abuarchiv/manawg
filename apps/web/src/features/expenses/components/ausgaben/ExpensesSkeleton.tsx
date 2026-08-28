import { LIST_CARD } from '@/components/ui/styles';

const SKELETON_KEYS = ['s0', 's1', 's2', 's3'];

export function ExpensesSkeleton() {
	return (
		<ul className={LIST_CARD}>
			{SKELETON_KEYS.map((k, idx) => (
				// Mirrors real row: py-2.5 pl-3 pr-2 with two-line content block
				<li key={k} className="flex items-center gap-2 py-2.5 pl-3 pr-2 sm:pl-4 sm:pr-3">
					<div className="min-w-0 flex-1 space-y-1.5">
						{/* Title + amount row */}
						<div className="flex items-baseline gap-2">
							<span
								className="h-[14px] animate-pulse rounded bg-[var(--surface-strong)]"
								style={{ width: `${40 + (idx % 3) * 15}%` }}
							/>
							<span className="ml-auto h-[14px] w-16 shrink-0 animate-pulse rounded bg-[var(--surface-strong)]" />
						</div>
						{/* Meta row: avatar dot + name + date */}
						<div className="flex items-center gap-1.5">
							<span className="h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-[var(--surface-strong)]" />
							<span className="h-[11px] w-16 animate-pulse rounded bg-[var(--surface-strong)]" />
							<span className="h-[11px] w-12 animate-pulse rounded bg-[var(--surface-strong)]" />
						</div>
					</div>
					{/* Chevron placeholder */}
					<span className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-[var(--surface-strong)]" />
					{/* Delete button placeholder */}
					<span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[var(--surface-strong)]" />
				</li>
			))}
		</ul>
	);
}
