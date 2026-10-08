'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { importActionErrorMessage } from '@/features/expenses/import-errors';
import type { RecoveryAction } from '@/features/expenses/import-errors';
import Link from 'next/link';
import type { Ref } from 'react';
import { ImportProgress } from './ImportProgress';
import { ImportStepHeading } from './ImportStepHeading';
import { ImportUndo } from './ImportUndo';
import type { CommitResponse } from './import-wizard-types';

interface ImportResultStepProps {
	headingRef: Ref<HTMLHeadingElement>;
	result: CommitResponse;
	recoveryAction: RecoveryAction | null;
	onRecover: (action: RecoveryAction) => void;
	expensesHref: string;
}

export function ImportResultStep({
	headingRef,
	result,
	recoveryAction,
	onRecover,
	expensesHref,
}: ImportResultStepProps) {
	return (
		<section className="flex flex-col gap-4">
			<ImportStepHeading headingRef={headingRef}>Import abgeschlossen</ImportStepHeading>
			<ImportProgress
				state="done"
				inserted={result.inserted}
				skipped={result.skipped}
				errors={result.errors.length}
			/>
			{result.warning && (
				<Alert>
					<AlertTitle>Hinweis zur Benachrichtigung</AlertTitle>
					<AlertDescription>
						{result.warning === 'notification_delivery_failed'
							? 'Der Import wurde gespeichert, aber die WG-Benachrichtigung konnte nicht an alle zugestellt werden.'
							: 'Der Import wurde gespeichert, aber die Zustellung der WG-Benachrichtigung konnte nicht bestätigt werden.'}
					</AlertDescription>
				</Alert>
			)}
			{result.errors.length > 0 && (
				<Alert variant="destructive">
					<AlertTitle>Nicht übernommene Einträge</AlertTitle>
					<AlertDescription className="flex flex-col items-start gap-3">
						<ul className="flex flex-col gap-2">
							{result.errors.map((item) => (
								<li key={item.index}>
									Eintrag {item.index + 1}: {importActionErrorMessage(item.reason)}
								</li>
							))}
						</ul>
						{recoveryAction && (
							<Button variant="outline" onClick={() => onRecover(recoveryAction)}>
								{recoveryAction.label}
							</Button>
						)}
					</AlertDescription>
				</Alert>
			)}
			{result.inserted > 0 && <ImportUndo importId={result.importId} />}
			<Link href={expensesHref} className={buttonVariants({ className: 'min-h-11' })}>
				Zu den Ausgaben
			</Link>
		</section>
	);
}
