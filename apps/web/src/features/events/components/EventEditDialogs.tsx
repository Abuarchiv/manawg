import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
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

/** Id of the calendar page heading, the focus target when the edited row is gone. */
export const CALENDAR_HEADING_ID = 'calendar-heading';

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
	// A deleted event leaves no row for the drawer to return focus to. After the drawer's own
	// focus return has run, a page that still has no focus gets the heading.
	useEffect(
		() => () => {
			requestAnimationFrame(() => {
				if (document.activeElement === document.body) {
					document.getElementById(CALENDAR_HEADING_ID)?.focus({ preventScroll: true });
				}
			});
		},
		[],
	);
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
