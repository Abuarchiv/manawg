const CARD_KEYS = ['c0', 'c1', 'c2'] as const;

const BAR_ROWS = [
	{ width: 'w-3/4', key: 'r0' },
	{ width: 'w-full', key: 'r1' },
	{ width: 'w-1/2', key: 'r2' },
] as const;

// craftsman-ignore: TS002 — Next.js App Router requires default export from loading.tsx
export default function WgLoading() {
	return (
		<output
			aria-live="polite"
			aria-busy="true"
			aria-label="WG-Dashboard wird geladen"
			className="mx-auto block max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8"
		>
			{/* Header area skeleton */}
			<header className="flex items-end justify-between gap-3">
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<span className="h-7 w-7 animate-pulse rounded-xl bg-[var(--surface-strong)]" />
						<span className="h-6 w-36 animate-pulse rounded-lg bg-[var(--surface-strong)]" />
					</div>
					<span className="block h-3 w-20 animate-pulse rounded bg-[var(--surface-strong)]" />
				</div>
				<span className="h-10 w-10 animate-pulse rounded-xl bg-[var(--surface-strong)]" />
			</header>

			{/* Placeholder cards */}
			<ul className="space-y-4">
				{CARD_KEYS.map((k) => (
					<li
						key={k}
						className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-5"
						aria-hidden
					>
						{/* Card header row */}
						<div className="mb-4 flex items-center gap-3">
							<span className="h-9 w-9 animate-pulse rounded-full bg-[var(--surface-strong)]" />
							<div className="flex-1 space-y-1.5">
								<span className="block h-3.5 w-28 animate-pulse rounded bg-[var(--surface-strong)]" />
								<span className="block h-2.5 w-16 animate-pulse rounded bg-[var(--surface-strong)]" />
							</div>
						</div>

						{/* Content bars */}
						<div className="space-y-2">
							{BAR_ROWS.map((r) => (
								<span
									key={r.key}
									className={`block h-3 ${r.width} animate-pulse rounded bg-[var(--surface-strong)]`}
								/>
							))}
						</div>
					</li>
				))}
			</ul>
		</output>
	);
}
