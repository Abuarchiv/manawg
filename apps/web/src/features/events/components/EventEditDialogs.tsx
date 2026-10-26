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
	return (
		<>
			<AlertDialog open={confirmingDelete} onOpenChange={onConfirmingDeleteChange}>
				<AlertDialogContent className="w-[calc(100%-2rem)]">
					<AlertDialogHeader>
						<AlertDialogTitle>
							{onlyThis ? 'Diesen Termin löschen?' : 'Termin löschen?'}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{onlyThis
								? `Nur dieser Termin von „${title}“ wird gelöscht, die übrigen Termine der Serie bleiben.`
								: recurring
									? `„${title}“ wird unwiderruflich gelöscht, mit allen zukünftigen Terminen der Serie.`
									: `„${title}“ wird unwiderruflich gelöscht.`}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting} className="min-h-11">
							Abbrechen
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={onDelete}
							disabled={deleting}
							className="min-h-11"
						>
							{deleting && <Spinner data-icon="inline-start" aria-hidden />}
							{deleting ? 'Löscht…' : 'Löschen'}
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
