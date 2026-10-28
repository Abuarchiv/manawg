import { useTranslations } from 'next-intl';
import { LogoMark } from '@/components/ui/LogoMark';
import { cn } from '@/shared/lib/cn';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
	const t = useTranslations('shell.ui');
	return (
		<LogoMark
			tile={false}
			loading
			size={20}
			data-slot="spinner"
			role="status"
			aria-label={t('loading')}
			className={cn('size-4', className)}
			{...props}
		/>
	);
}

export { Spinner };
