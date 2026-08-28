const SKEL_KEYS = ['p0', 'p1'];

export function AnnouncementSkeleton() {
	return (
		// biome-ignore lint/a11y/useSemanticElements: skeleton list needs <ul> structure; <output> can't contain list items
		<ul
			role="status"
			aria-busy="true"
			aria-live="polite"
			aria-label="Pinnwand wird geladen"
			className="space-y-5"
		>
			{SKEL_KEYS.map((k) => (
				<li
					key={k}
					className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)]"
				>
					{/* header — mirrors pt-4 px-4 pb-3 sm:px-5 of real card */}
					<div className="flex items-center gap-3 px-4 pb-3 pt-4 sm:px-5">
						<span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[var(--surface-strong)]" />
						<div className="space-y-1.5">
							<span className="block h-3 w-28 animate-pulse rounded bg-[var(--surface-strong)]" />
							<span className="block h-2.5 w-16 animate-pulse rounded bg-[var(--surface-strong)]" />
						</div>
					</div>
					{/* body — mirrors px-4 pb-4 pt-3 sm:px-5 of real card */}
					<div className="px-4 pb-4 pt-3 sm:px-5">
						<span className="block h-3.5 w-full animate-pulse rounded bg-[var(--surface-strong)]" />
						<span className="mt-2 block h-3.5 w-4/5 animate-pulse rounded bg-[var(--surface-strong)]" />
						<span className="mt-2 block h-3.5 w-2/3 animate-pulse rounded bg-[var(--surface-strong)]" />
					</div>
				</li>
			))}
		</ul>
	);
}
