import { useTranslations } from 'next-intl';
import { ErrorBox } from '@/components/app/ErrorBox';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * A failed lookup with a retry button. While `loading` the button stays mounted
 * (and focused) so a screen reader keeps its place during the rerun.
 */
export function RetryNotice({
	message,
	onRetry,
	loading,
}: {
	message: string;
	onRetry: () => void;
	loading: boolean;
}) {
	const t = useTranslations('entry.public');
	return (
		<div className="flex flex-col gap-2">
			<ErrorBox>{message}</ErrorBox>
			<Button
				type="button"
				variant="outline"
				focusableWhenDisabled
				disabled={loading}
				aria-busy={loading}
				className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
				onClick={onRetry}
			>
				{loading && <Spinner data-icon="inline-start" aria-hidden />}
				{loading ? t('rechecking') : t('recheck')}
			</Button>
		</div>
	);
}
