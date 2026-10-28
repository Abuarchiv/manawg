'use client';

import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface ExpenseFormNoticesProps {
	pendingPrefillDescription: string | null;
	isEditingQueued: boolean;
	formSaving: boolean;
	onAskReplace: () => void;
}

/** Banners above the form fields: a handoff waiting behind an existing draft, a queued edit. */
export function ExpenseFormNotices({
	pendingPrefillDescription,
	isEditingQueued,
	formSaving,
	onAskReplace,
}: ExpenseFormNoticesProps) {
	const t = useTranslations('expenses-form.draft');
	return (
		<>
			{pendingPrefillDescription && (
				<Alert>
					<AlertDescription>{t('existingKept')}</AlertDescription>
					<Button
						type="button"
						variant="outline"
						className="mt-3 h-auto w-full whitespace-normal"
						disabled={formSaving}
						onClick={onAskReplace}
					>
						{t('replaceWith', { description: pendingPrefillDescription })}
					</Button>
				</Alert>
			)}
			{isEditingQueued && (
				<Alert>
					<AlertDescription className="text-foreground">{t('notSynced')}</AlertDescription>
				</Alert>
			)}
		</>
	);
}
