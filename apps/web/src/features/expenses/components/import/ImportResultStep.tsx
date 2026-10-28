'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { Ref } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatEuroCents } from '@/core/utils/money';
import type { RecoveryAction } from '@/features/expenses/import-errors';
import { importActionErrorMessage } from '@/features/expenses/import-errors';
import type { ParsedExpense } from '@/features/expenses/import-parsers';
import { useMessage } from '@/shared/i18n/message';
import { ImportProgress } from './ImportProgress';
import { ImportStepHeading } from './ImportStepHeading';
import { ImportUndo } from './ImportUndo';
import { formatImportDate } from './import-date';
import type { CommitResponse } from './import-wizard-types';

interface ImportResultStepProps {
	headingRef: Ref<HTMLHeadingElement>;
	result: CommitResponse;
	recoveryAction: RecoveryAction | null;
	onRecover: (action: RecoveryAction) => void;
	expensesHref: string;
	/** Rows of the preview, so an error can name the expense behind its index. */
	parsed?: readonly ParsedExpense[] | undefined;
}

export function ImportResultStep({
	headingRef,
	result,
	recoveryAction,
	onRecover,
	expensesHref,
	parsed = [],
}: ImportResultStepProps) {
	const t = useTranslations('expenses-import');
	const renderMessage = useMessage();
	const locale = useLocale();
	return (
		<section className="flex flex-col gap-4">
			<ImportStepHeading headingRef={headingRef}>{t('result.heading')}</ImportStepHeading>
			<ImportProgress
				state="done"
				inserted={result.inserted}
				skipped={result.skipped}
				errors={result.errors.length}
			/>
			{result.warning && (
				<Alert>
					<AlertTitle>{t('result.warningTitle')}</AlertTitle>
					<AlertDescription>
						{result.warning === 'notification_delivery_failed'
							? t('result.warningFailed')
							: t('result.warningUnknown')}
					</AlertDescription>
				</Alert>
			)}
			{result.errors.length > 0 && (
				<Alert variant="destructive">
					<AlertTitle>{t('result.rejectedTitle')}</AlertTitle>
					<AlertDescription className="flex flex-col items-start gap-3">
						<ul className="flex flex-col gap-2">
							{result.errors.map((item) => {
								const row = parsed[item.index];
								const number = String(item.index + 1);
								const reason = renderMessage(importActionErrorMessage(item.reason));
								return (
									<li key={item.index}>
										{row
											? t('result.rejectedEntryWithRow', {
													number,
													description: row.description,
													date: formatImportDate(row.date, locale),
													amount: formatEuroCents(row.amountCents, row.currency, { locale }),
													reason,
												})
											: t('result.rejectedEntry', { number, reason })}
									</li>
								);
							})}
						</ul>
						{recoveryAction && (
							<Button variant="outline" onClick={() => onRecover(recoveryAction)}>
								{renderMessage(recoveryAction.label)}
							</Button>
						)}
					</AlertDescription>
				</Alert>
			)}
			{result.inserted > 0 && <ImportUndo importId={result.importId} />}
			<Link href={expensesHref} className={buttonVariants({ className: 'min-h-11' })}>
				{t('actions.toExpenses')}
			</Link>
		</section>
	);
}
