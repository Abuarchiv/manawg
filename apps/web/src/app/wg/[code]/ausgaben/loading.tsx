import { Skeleton } from '@/components/ui/skeleton';
import { useTranslations } from 'next-intl';

export default function Loading() {
	const t = useTranslations('expenses.page');
	return (
		<output
			aria-live="polite"
			aria-busy="true"
			aria-label={t('loading')}
			className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3"
		>
			<Skeleton aria-hidden className="h-9 w-full rounded-lg" />
			<Skeleton aria-hidden className="h-3 w-20" />
			<Skeleton aria-hidden className="h-7 w-2/3" />
			<Skeleton aria-hidden className="h-4 w-1/3" />
		</output>
	);
}
