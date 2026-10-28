import { Skeleton } from '@/components/ui/skeleton';

const WEEKS = ['w0', 'w1'] as const;
const ROWS = ['r0', 'r1', 'r2'] as const;

/** Mirrors the real list: week heading followed by a rounded list of rows. */
export function ExpensesSkeleton() {
	return (
		<div aria-busy="true" className="flex flex-col gap-4">
			{WEEKS.map((week) => (
				<div key={week} aria-hidden="true" className="flex flex-col gap-1.5">
					<Skeleton className="h-3 w-16" />
					<div className="divide-y divide-border/60 overflow-hidden rounded-xl border">
						{ROWS.map((row) => (
							<div key={row} className="flex items-center gap-3 px-3 py-2.5">
								<div className="flex min-w-0 flex-1 flex-col gap-1.5">
									<Skeleton className="h-4 w-2/3" />
									<Skeleton className="h-3 w-1/2" />
								</div>
								<Skeleton className="h-4 w-16" />
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
