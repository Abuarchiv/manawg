import { LIST_CARD } from '@/components/ui/styles';

const SKELETON_KEYS = ['s0', 's1', 's2'];

export function ListSkeleton() {
	return (
		<ul className={LIST_CARD}>
			{SKELETON_KEYS.map((k) => (
				<li key={k} className="flex min-h-[64px] items-center gap-3 px-3 py-3 sm:px-4">
					<div className="min-w-0 flex-1 space-y-2">
						<span className="block h-[15px] w-2/3 animate-pulse rounded bg-[var(--surface-strong)]" />
						<div className="flex items-center gap-1.5">
							<span className="block h-5 w-5 animate-pulse rounded-full bg-[var(--surface-strong)]" />
							<span className="block h-[12.5px] w-1/4 animate-pulse rounded bg-[var(--surface-strong)]" />
							<span className="block h-[12.5px] w-16 animate-pulse rounded-full bg-[var(--surface-strong)]" />
						</div>
					</div>
					<span className="h-11 w-11 animate-pulse rounded-full bg-[var(--surface-strong)]" />
				</li>
			))}
		</ul>
	);
}
