import { useTranslations } from 'next-intl';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function ClearBoughtDialog({
	open,
	onOpenChange,
	doneCount,
	clearing,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	doneCount: number;
	clearing: boolean;
	onConfirm: () => void;
}) {
	const t = useTranslations('shopping.clearDialog');
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="max-w-[calc(100%-2rem)]">
				<AlertDialogHeader>
					<AlertDialogTitle>{t('title')}</AlertDialogTitle>
					<AlertDialogDescription>{t('description', { count: doneCount })}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel className="min-h-11">{t('cancel')}</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						className="min-h-11 min-w-0 max-w-full shrink whitespace-normal"
						disabled={clearing}
						onClick={() => {
							onOpenChange(false);
							onConfirm();
						}}
					>
						{t('confirm')}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
