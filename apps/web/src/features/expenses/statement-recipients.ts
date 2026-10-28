import type { Locale } from '@/shared/i18n/locale';
import type { ExpensePaymentInput } from './expense-payment-input';
import {
	buildMonthlyStatement,
	type MonthlyStatement,
	type StatementExpense,
} from './monthly-statement';

type StatementSkipReason =
	| 'inactive'
	| 'no_email'
	| 'opted_out'
	| 'not_participant'
	| 'single_participant';

export interface StatementWgMember {
	id: string;
	name: string;
	active: boolean;
	/** The member's `notify_statement_email` preference. */
	notify: boolean;
	/** Confirmed Auth e-mail address, `null` without an account or while unconfirmed. */
	email: string | null;
	/** The Auth lookup failed: the address is unknown, so the member is neither mailed nor skipped. */
	lookupFailed?: boolean;
	/** The member's stored language; German when absent. */
	locale?: Locale;
}

export interface StatementRecipient {
	memberId: string;
	name: string;
	email: string;
	statement: MonthlyStatement;
	locale?: Locale;
}

export interface StatementPlan {
	recipients: StatementRecipient[];
	skipped: Array<{ memberId: string; reason: StatementSkipReason }>;
}

function skipReason(
	member: StatementWgMember,
	participants: ReadonlySet<string>,
): StatementSkipReason | null {
	if (!member.active) return 'inactive';
	if (participants.size < 2) return 'single_participant';
	if (!member.notify) return 'opted_out';
	if (!member.email) return 'no_email';
	if (!participants.has(member.id)) return 'not_participant';
	return null;
}

/**
 * Who of one WG gets the statement mail for a month. A WG without EUR
 * expenses yields an empty plan; a WG with fewer than two participants mails
 * nobody. Every other member is either a recipient or skipped with the first
 * reason that applies. Members whose address lookup failed appear in neither
 * list, so a later run decides about them.
 */
export function planStatementMails(
	members: readonly StatementWgMember[],
	expenses: readonly StatementExpense[],
	monthKey: string,
	payments: readonly ExpensePaymentInput[] = [],
): StatementPlan {
	const statement = buildMonthlyStatement(expenses, members, monthKey, payments);
	const plan: StatementPlan = { recipients: [], skipped: [] };
	if (statement.items.length === 0) return plan;

	const participants = new Set(
		statement.members.filter((row) => row.paidCents > 0 || row.shareCents > 0).map((row) => row.id),
	);
	for (const member of members) {
		if (member.lookupFailed) continue;
		const reason = skipReason(member, participants);
		if (reason) plan.skipped.push({ memberId: member.id, reason });
		else if (member.email) {
			plan.recipients.push({
				memberId: member.id,
				name: member.name,
				email: member.email,
				statement,
				...(member.locale ? { locale: member.locale } : {}),
			});
		}
	}
	return plan;
}
