'use client';

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
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

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
	const t = useTranslations('pinnwand.delete');
	const render = useMessage();
	const deletingRef = useRef(false);
	const [deleteError, setDeleteError] = useState<Message | null>(null);
	// Every opening starts without the previous attempt's error.
	useEffect(() => {
		if (open) setDeleteError(null);
	}, [open]);
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
							try {
								const message = await onDelete();
								if (message === null) onOpenChange(false);
								else setDeleteError(message);
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
