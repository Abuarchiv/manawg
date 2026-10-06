'use client';

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

/** Confirms replacing the current draft with a prefilled expense. */
export function ReplaceDraftDialog({
	open,
	onOpenChange,
	prefillDescription,
	onReplace,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	prefillDescription: string | null;
	onReplace: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Entwurf verwerfen?</AlertDialogTitle>
					<AlertDialogDescription>
						Deine ungespeicherten Eingaben werden durch „{prefillDescription}“ ersetzt. Bereits
						gespeicherte Ausgaben bleiben erhalten.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="flex-col">
					<AlertDialogCancel className="min-h-11">Entwurf behalten</AlertDialogCancel>
					<AlertDialogAction variant="destructive" className="min-h-11" onClick={onReplace}>
						Entwurf verwerfen
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/** Closing a changed form: keep the draft for later, or discard it. */
export function CloseDraftDialog({
	open,
	onOpenChange,
	onDiscard,
	onKeep,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDiscard: () => void;
	onKeep: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Entwurf behalten?</AlertDialogTitle>
					<AlertDialogDescription>
						Es wird keine Ausgabe gespeichert. Du kannst deinen Entwurf später weiterbearbeiten oder
						ausdrücklich verwerfen.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="flex-col">
					<AlertDialogCancel className="min-h-11">Weiterbearbeiten</AlertDialogCancel>
					<AlertDialogAction variant="destructive" className="min-h-11" onClick={onDiscard}>
						Entwurf verwerfen
					</AlertDialogAction>
					<AlertDialogAction className="min-h-11" onClick={onKeep}>
						Entwurf behalten
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
