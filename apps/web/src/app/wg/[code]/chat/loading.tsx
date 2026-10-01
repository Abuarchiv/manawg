import { Skeleton } from '@/components/ui/skeleton';

export default function ChatLoading() {
	return (
		<output
			className="flex min-h-80 flex-col gap-5 px-4 py-5"
			aria-label="Chat wird geladen"
			aria-busy="true"
		>
			<Skeleton className="h-7 w-32" />
			<Skeleton className="h-11 w-full" />
			<Skeleton className="h-20 w-3/4" />
			<Skeleton className="h-16 w-2/3 self-end" />
			<Skeleton className="mt-auto h-14 w-full" />
		</output>
	);
}
