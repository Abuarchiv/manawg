import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { loadConfirmedEmails } from '@/core/auth/auth-user-emails';
import { db, expenseSplits, expenses } from '@/core/db';
import { logApiError } from '@/core/infra/observability';
import { sendMailSafely } from '@/core/mail/send-mail';
import { renderReminderMail } from '@/core/mail/templates';
import { memberLocale, unsubscribeUrl } from '@/core/mail/unsubscribe';
import { formatShortDate } from '@/core/utils/time';
import { DEFAULT_LOCALE } from '@/shared/i18n/locale';

const ITEM_LIMIT = 5;

export interface ReminderMailInput {
	reminderId: string;
	wg: { id: string; name: string; shareCode: string };
	debtor: { id: string; authUserId: string };
	creditor: { id: string; name: string };
	amountCents: number;
	oldestDebtAgeDays: number;
}

/**
 * Sends a reminder as a mail to a debtor without push. Lists the newest open
 * items the creditor paid for the debtor; one mail per reminder row.
 */
export async function sendReminderMail(input: ReminderMailInput): Promise<void> {
	try {
		const { emails } = await loadConfirmedEmails([input.debtor.authUserId]);
		const to = emails.get(input.debtor.authUserId);
		if (!to) return;
		const locale = (await memberLocale(input.debtor.id)) ?? DEFAULT_LOCALE;
		const rows = await db
			.select({
				description: expenses.description,
				occurredAt: expenses.occurredAt,
				cents: expenseSplits.amountCents,
			})
			.from(expenseSplits)
			.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
			.where(
				and(
					eq(expenses.wgId, input.wg.id),
					eq(expenses.paidByMemberId, input.creditor.id),
					eq(expenseSplits.debtorMemberId, input.debtor.id),
					isNull(expenseSplits.settledAt),
				),
			)
			.orderBy(desc(expenses.occurredAt))
			.limit(ITEM_LIMIT);
		await sendMailSafely({
			kind: 'reminder',
			dedupeKey: `reminder:${input.reminderId}`,
			to,
			wgId: input.wg.id,
			memberId: input.debtor.id,
			unsubscribeUrl: unsubscribeUrl(input.debtor.id, 'reminders'),
			mail: renderReminderMail({
				wgName: input.wg.name,
				shareCode: input.wg.shareCode,
				creditorName: input.creditor.name,
				amountCents: input.amountCents,
				oldestDebtAgeDays: input.oldestDebtAgeDays,
				items: rows.map((row) => ({
					description: row.description,
					date: formatShortDate(row.occurredAt.toISOString(), 'Europe/Berlin', locale),
					cents: row.cents,
				})),
				unsubscribeUrl: unsubscribeUrl(input.debtor.id, 'reminders'),
				locale,
			}),
		});
	} catch (err) {
		logApiError('[mail] reminder mail failed', err);
	}
}
