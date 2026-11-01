'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { type Message, useMessage } from '@/shared/i18n/message';

/** Id of the pinboard page heading, the focus target when the removed post's card is gone. */
export const PINBOARD_HEADING_ID = 'pinboard-heading';

interface AnnouncementDeleteDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	actionSubject: string;
	deletePending: boolean;
	/** null = removed, otherwise the error message for the dialog. */
	onDelete: () => Promise<Message | null>;
}

/** Confirmation before a post and its replies are removed; stays open with an error on failure. */
export function AnnouncementDeleteDialog({
	open,
	onOpenChange,
	actionSubject,
	deletePending,
	onDelete,
}: AnnouncementDeleteDialogProps) {
	const t = useTranslations('pinboard.delete');
	const render = useMessage();
	const deletingRef = useRef(false);
	const deletedRef = useRef(false);
	const [deleteError, setDeleteError] = useState<Message | null>(null);
	// Every opening starts without the previous attempt's error.
	useEffect(() => {
		if (open) setDeleteError(null);
	}, [open]);
	// The dialog lives inside the post's card. When the card vanishes after a removal and the
	// dialog's own focus return has run, a page that still has no focus gets the heading.
	useEffect(
		() => () => {
			if (!deletedRef.current) return;
			requestAnimationFrame(() => {
				if (document.activeElement === document.body) {
					document.getElementById(PINBOARD_HEADING_ID)?.focus({ preventScroll: true });
				}
			});
		},
		[],
	);
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!deletePending && !deletingRef.current) onOpenChange(next);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('title')}</AlertDialogTitle>
					<AlertDialogDescription>{t('body', { subject: actionSubject })}</AlertDialogDescription>
				</AlertDialogHeader>
				{deleteError && (
					<Alert variant="destructive">
						<AlertDescription>{render(deleteError)}</AlertDescription>
					</Alert>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={deletePending} className="min-h-11">
						{t('cancel')}
					</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={deletePending}
						className="min-h-11"
						aria-label={t('confirmAria', { subject: actionSubject })}
						onClick={async () => {
							// Lock synchronously: the built-in close runs before the next render.
							deletingRef.current = true;
							setDeleteError(null);
							// A successful removal can unmount the card before this await resumes.
							deletedRef.current = true;
							try {
								const message = await onDelete();
								if (message === null) onOpenChange(false);
								else {
									deletedRef.current = false;
									setDeleteError(message);
								}
							} finally {
								deletingRef.current = false;
							}
						}}
					>
						{deletePending && <Spinner data-icon="inline-start" />}
						{deletePending ? t('removing') : t('remove')}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
