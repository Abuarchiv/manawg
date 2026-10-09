import {
	type MonthlyStatement,
	type StatementExpense,
	buildMonthlyStatement,
} from './monthly-statement';

export type StatementSkipReason =
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
}

export interface StatementRecipient {
	memberId: string;
	name: string;
	email: string;
	statement: MonthlyStatement;
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
 * reason that applies.
 */
export function planStatementMails(
	members: readonly StatementWgMember[],
	expenses: readonly StatementExpense[],
	monthKey: string,
): StatementPlan {
	const statement = buildMonthlyStatement(expenses, members, monthKey);
	const plan: StatementPlan = { recipients: [], skipped: [] };
	if (statement.items.length === 0) return plan;

	const participants = new Set(
		statement.members.filter((row) => row.paidCents > 0 || row.shareCents > 0).map((row) => row.id),
	);
	for (const member of members) {
		const reason = skipReason(member, participants);
		if (reason) plan.skipped.push({ memberId: member.id, reason });
		else if (member.email) {
			plan.recipients.push({
				memberId: member.id,
				name: member.name,
				email: member.email,
				statement,
			});
		}
	}
	return plan;
}
