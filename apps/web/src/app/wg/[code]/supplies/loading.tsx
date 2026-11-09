import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { ListSkeleton } from '@/features/inventory/components/ListSkeleton';

export default function Loading() {
	const t = useTranslations('common');
	return (
		<output
			aria-live="polite"
			aria-busy="true"
			aria-label={t('loading')}
			className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3"
		>
			<Skeleton aria-hidden className="h-9 w-full rounded-lg" />
			<ListSkeleton />
		</output>
	);
}
