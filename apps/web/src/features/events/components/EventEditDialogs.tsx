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
import { Spinner } from '@/components/ui/spinner';
import { DiscardChangesDialog } from '@/features/events/components/DiscardChangesDialog';
import { useTranslations } from 'next-intl';

/** The two confirmations of the event drawer: delete (series or one date) and discard changes. */
export function EventEditDialogs({
	title,
	recurring,
	onlyThis,
	confirmingDelete,
	onConfirmingDeleteChange,
	deleting,
	onDelete,
	confirmingDiscard,
	onConfirmingDiscardChange,
	onDiscard,
}: {
	title: string;
	recurring: boolean;
	onlyThis: boolean;
	confirmingDelete: boolean;
	onConfirmingDeleteChange: (open: boolean) => void;
	deleting: boolean;
	onDelete: () => void;
	confirmingDiscard: boolean;
	onConfirmingDiscardChange: (open: boolean) => void;
	onDiscard: () => void;
}) {
	const t = useTranslations('events');
	const kind = onlyThis ? 'occurrence' : recurring ? 'series' : 'single';
	return (
		<>
			<AlertDialog open={confirmingDelete} onOpenChange={onConfirmingDeleteChange}>
				<AlertDialogContent className="w-[calc(100%-2rem)]">
					<AlertDialogHeader>
						<AlertDialogTitle>
							{onlyThis ? t('deleteDialog.titleOccurrence') : t('deleteDialog.titleEvent')}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t('deleteDialog.description', { kind, title })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting} className="min-h-11">
							{t('actions.cancel')}
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={onDelete}
							disabled={deleting}
							className="min-h-11"
						>
							{deleting && <Spinner data-icon="inline-start" aria-hidden />}
							{deleting ? t('actions.deleting') : t('actions.delete')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<DiscardChangesDialog
				open={confirmingDiscard}
				onOpenChange={onConfirmingDiscardChange}
				onDiscard={onDiscard}
			/>
		</>
	);
}
