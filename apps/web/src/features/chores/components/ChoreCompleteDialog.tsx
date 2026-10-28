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
import { Spinner } from '@/components/ui/spinner';
import type { NextAssignee } from '@/features/chores/chore-completion';
import type { ChoreAction } from '@/features/chores/chore-status';
import type { Message } from '@/shared/i18n/message';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

/** Trigger wording: Start and cleaning plan use the same labels. */
export function completeTriggerLabel(title: string, action: ChoreAction): Message {
	return {
		key:
			action === 'catchUp'
				? 'chores.completeDialog.trigger.catchUp'
				: 'chores.completeDialog.trigger.complete',
		values: { title },
	};
}

/** Second step when completing, shared by Start and cleaning plan. */
export function ChoreCompleteDialog({
	open,
	title,
	action,
	busy,
	error,
	nextAssignee,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	title: string;
	action: ChoreAction;
	busy: boolean;
	error: string | null;
	nextAssignee?: NextAssignee | null;
	onCancel: () => void;
	onConfirm: () => void;
}): ReactElement {
	const t = useTranslations('chores.completeDialog');
	const upNext =
		nextAssignee === undefined
			? 'unknown'
			: nextAssignee
				? nextAssignee.isSelf
					? 'self'
					: 'named'
				: 'nobody';
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onCancel();
			}}
		>
			<AlertDialogContent className="w-[calc(100%-2rem)]">
				<AlertDialogHeader>
					<AlertDialogTitle>{t('title', { title })}</AlertDialogTitle>
					<AlertDialogDescription>
						{t('description', { upNext, name: nextAssignee?.name ?? '' })}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy} className="min-h-11">
						{t('cancel')}
					</AlertDialogCancel>
					<Button
						onClick={() => {
							if (!busy) onConfirm();
						}}
						// aria-disabled instead of disabled: focus stays on the button while saving.
						aria-disabled={busy}
						className="aria-disabled:opacity-50"
						aria-label={t(`confirmAria.${action}`, { title })}
					>
						{busy ? (
							<>
								<Spinner data-icon="inline-start" aria-hidden />
								{t('saving')}
							</>
						) : (
							t(`confirm.${action}`)
						)}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
