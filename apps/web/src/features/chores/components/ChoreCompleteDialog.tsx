'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { ReactElement } from 'react';

/** Trigger wording: the start page and the chore plan use the same labels. */
export function completeTriggerLabel(title: string, actionLabel: string): string {
	return actionLabel === 'Nachholen'
		? `Aufgabe nachholen: ${title}`
		: `Als erledigt markieren: ${title}`;
}

/** Second step of completing a chore, shared by the start page and the chore plan. */
export function ChoreCompleteDialog({
	open,
	title,
	actionLabel,
	busy,
	error,
	nextAssigneeName,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	title: string;
	actionLabel: string;
	busy: boolean;
	error: string | null;
	nextAssigneeName?: string | null;
	onCancel: () => void;
	onConfirm: () => void;
}): ReactElement {
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onCancel();
			}}
		>
			<AlertDialogContent className="w-[calc(100%-2rem)]">
				<AlertDialogHeader>
					<AlertDialogTitle>„{title}“ erledigt?</AlertDialogTitle>
					<AlertDialogDescription>
						{nextAssigneeName === undefined
							? null
							: nextAssigneeName
								? // The hook returns „du“ for the own member, which needs „bist“.
									`Danach ${nextAssigneeName === 'du' ? 'bist' : 'ist'} ${nextAssigneeName} dran. `
								: 'Für die nächste Runde ist gerade niemand verfügbar. '}
						Lässt sich nicht rückgängig machen.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy} className="min-h-11">
						Abbrechen
					</AlertDialogCancel>
					<Button
						onClick={() => {
							if (!busy) onConfirm();
						}}
						// aria-disabled instead of disabled: focus stays on the button while saving.
						aria-disabled={busy}
						className="aria-disabled:opacity-50"
						aria-label={`${actionLabel} bestätigen: ${title}`}
					>
						{actionLabel} bestätigen
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
