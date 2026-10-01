import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const CARD_KEYS = ['c0', 'c1', 'c2'] as const;

const BAR_ROWS = [
	{ width: 'w-3/4', key: 'r0' },
	{ width: 'w-full', key: 'r1' },
	{ width: 'w-1/2', key: 'r2' },
] as const;

export default function WgLoading() {
	return (
		<output
			aria-live="polite"
			aria-busy="true"
			aria-label="WG-Seite wird geladen"
			className="mx-auto block w-full max-w-md space-y-4 bg-background px-4 py-6"
		>
			{/* Header area skeleton */}
			<header className="flex items-end justify-between gap-3">
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<Skeleton className="size-7 rounded-lg" />
						<Skeleton className="h-6 w-36" />
					</div>
					<Skeleton className="h-3 w-20" />
				</div>
				<Skeleton className="size-10 rounded-lg" />
			</header>

			{/* Segment navigation placeholder */}
			<div aria-hidden className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
				<Skeleton className="h-10 rounded-lg" />
				<Skeleton className="h-10 rounded-lg" />
				<Skeleton className="h-10 rounded-lg" />
			</div>

			{/* Placeholder cards */}
			<ul className="space-y-4">
				{CARD_KEYS.map((k) => (
					<li key={k} aria-hidden>
						<Card>
							<CardContent className="space-y-4 pt-4">
								{/* Card header row */}
								<div className="flex items-center gap-3">
									<Skeleton className="size-9 rounded-full" />
									<div className="flex-1 space-y-1.5">
										<Skeleton className="h-3.5 w-28" />
										<Skeleton className="h-2.5 w-16" />
									</div>
								</div>

								{/* Content bars */}
								<div className="space-y-2">
									{BAR_ROWS.map((r) => (
										<Skeleton key={r.key} className={`h-3 ${r.width}`} />
									))}
								</div>
							</CardContent>
						</Card>
					</li>
				))}
			</ul>
		</output>
	);
}
