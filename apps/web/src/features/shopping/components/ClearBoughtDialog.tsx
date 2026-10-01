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
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="max-w-[calc(100%-2rem)]">
				<AlertDialogHeader>
					<AlertDialogTitle>Erledigte Artikel entfernen?</AlertDialogTitle>
					<AlertDialogDescription>
						{doneCount === 1
							? '1 erledigter Artikel wird'
							: `${doneCount} erledigte Artikel werden`}{' '}
						für die ganze WG endgültig entfernt. Offene Artikel bleiben erhalten.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel className="min-h-11">Abbrechen</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						className="min-h-11 min-w-0 max-w-full shrink whitespace-normal"
						disabled={clearing}
						onClick={() => {
							onOpenChange(false);
							onConfirm();
						}}
					>
						Entfernen
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
