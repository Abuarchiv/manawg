import { LogoMark } from '@/shared/components/ui/LogoMark';
import { cn } from '@/shared/lib/cn';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
	return (
		<LogoMark
			tile={false}
			loading
			size={20}
			data-slot="spinner"
			role="status"
			aria-label="Wird geladen"
			className={cn('size-4', className)}
			{...props}
		/>
	);
}

export { Spinner };
