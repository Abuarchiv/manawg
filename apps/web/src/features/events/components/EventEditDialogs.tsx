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
								? `Nur dieser Termin von „${title}“ wird entfernt, die übrigen Termine der Serie bleiben.`
								: recurring
									? `„${title}“ wird unwiderruflich entfernt, mit allen zukünftigen Terminen der Serie.`
									: `„${title}“ wird unwiderruflich entfernt.`}
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
			<AlertDialog open={confirmingDiscard} onOpenChange={onConfirmingDiscardChange}>
				<AlertDialogContent className="w-[calc(100%-2rem)]">
					<AlertDialogHeader>
						<AlertDialogTitle>Änderungen verwerfen?</AlertDialogTitle>
						<AlertDialogDescription>
							Deine Eingaben sind noch nicht gespeichert.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">Weiter bearbeiten</AlertDialogCancel>
						<AlertDialogAction variant="destructive" className="min-h-11" onClick={onDiscard}>
							Verwerfen
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
