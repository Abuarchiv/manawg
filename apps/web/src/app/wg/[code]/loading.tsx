import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';

const ROWS = ['r0', 'r1', 'r2', 'r3'] as const;

export default function WgLoading() {
	const t = useTranslations('shell.loading');
	return (
		<output
			aria-live="polite"
			aria-busy="true"
			aria-label={t('wgPage')}
			className="mx-auto block w-full max-w-[var(--app-frame-width)] space-y-3 px-4 py-4"
		>
			{ROWS.map((k) => (
				<Skeleton key={k} aria-hidden className="h-12 w-full rounded-lg" />
			))}
		</output>
	);
}
