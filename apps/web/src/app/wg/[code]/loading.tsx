import { Skeleton } from '@/components/ui/skeleton';

const ROWS = ['r0', 'r1', 'r2', 'r3'] as const;

export default function WgLoading() {
	return (
		<output
			aria-live="polite"
			aria-busy="true"
			aria-label="WG-Seite wird geladen"
			className="mx-auto block w-full max-w-[var(--app-frame-width)] space-y-3 px-4 py-4"
		>
			{ROWS.map((k) => (
				<Skeleton key={k} aria-hidden className="h-12 w-full rounded-lg" />
			))}
		</output>
	);
}
