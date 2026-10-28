'use client';

import { useTranslations } from 'next-intl';
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
	const t = useTranslations('expenses-form.draft');
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('replaceTitle')}</AlertDialogTitle>
					<AlertDialogDescription>
						{t('replaceBody', { description: prefillDescription ?? '' })}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="flex-col">
					<AlertDialogCancel className="min-h-11">{t('replaceKeep')}</AlertDialogCancel>
					<AlertDialogAction variant="destructive" className="min-h-11" onClick={onReplace}>
						{t('replaceDiscard')}
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
	const t = useTranslations('expenses-form.draft');
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('closeTitle')}</AlertDialogTitle>
					<AlertDialogDescription>{t('closeBody')}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="flex-col">
					<AlertDialogCancel className="min-h-11">{t('closeContinue')}</AlertDialogCancel>
					<AlertDialogAction variant="destructive" className="min-h-11" onClick={onDiscard}>
						{t('closeDiscard')}
					</AlertDialogAction>
					<AlertDialogAction className="min-h-11" onClick={onKeep}>
						{t('closeKeep')}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
