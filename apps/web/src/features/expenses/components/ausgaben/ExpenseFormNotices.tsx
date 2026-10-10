'use client';

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
	return (
		<>
			{pendingPrefillDescription && (
				<Alert>
					<AlertDescription>Dein vorhandener Entwurf bleibt erhalten.</AlertDescription>
					<Button
						type="button"
						variant="outline"
						className="mt-3 h-auto w-full whitespace-normal"
						disabled={formSaving}
						onClick={onAskReplace}
					>
						Entwurf verwerfen und „{pendingPrefillDescription}“ übernehmen
					</Button>
				</Alert>
			)}
			{isEditingQueued && (
				<Alert>
					<AlertDescription className="text-foreground">
						Noch nicht synchronisiert. Die Änderung wird gesendet, sobald du online bist.
					</AlertDescription>
				</Alert>
			)}
		</>
	);
}
