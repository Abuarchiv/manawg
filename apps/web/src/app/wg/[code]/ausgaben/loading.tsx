import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
	return (
		<output
			aria-live="polite"
			aria-busy="true"
			aria-label="Ausgaben werden geladen"
			className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3"
		>
			<Skeleton aria-hidden className="h-9 w-full rounded-lg" />
			<Skeleton aria-hidden className="h-3 w-20" />
			<Skeleton aria-hidden className="h-7 w-2/3" />
			<Skeleton aria-hidden className="h-4 w-1/3" />
		</output>
	);
}
