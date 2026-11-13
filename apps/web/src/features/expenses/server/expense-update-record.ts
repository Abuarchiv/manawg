import 'server-only';
import { recordAuditEvent } from '@/core/audit';
import type { ExpenseShare } from '../expense-change-notices';
import { notifyExpenseUpdated } from './expense-change-notify';

/**
 * Logs a saved expense edit with the old and the new amount, then tells the members whose share
 * changed. `replacedShares` are the shares before an edit that replaced them, null when the edit
 * left them alone.
 */
export async function recordExpenseUpdate(input: {
	wg: { id: string; name: string; shareCode: string };
	actor: { memberId: string; name: string };
	before: { amountCents: number; occurredAt: Date };
	replacedShares: ExpenseShare[] | null;
	after: {
		id: string;
		description: string;
		amountCents: number;
		currency: string;
		occurredAt: Date;
	};
	shares: ExpenseShare[];
}): Promise<void> {
	const { wg, actor, before, replacedShares, after, shares } = input;
	await recordAuditEvent({
		wgId: wg.id,
		memberId: actor.memberId,
		eventType: 'expense.updated',
		entityType: 'expense',
		entityId: after.id,
		actorName: actor.name,
		metadata: {
			description: after.description,
			amountCents: after.amountCents,
			currency: after.currency,
			splitCount: shares.length,
			previousAmountCents: before.amountCents,
			...(replacedShares && {
				previousShares: Object.fromEntries(
					replacedShares.map((share) => [share.debtorMemberId, share.amountCents]),
				),
			}),
		},
	});
	await notifyExpenseUpdated({
		wg,
		actor,
		title: after.description,
		currency: after.currency,
		expenseId: after.id,
		before: { ...before, shares: replacedShares ?? shares },
		after: { amountCents: after.amountCents, occurredAt: after.occurredAt, shares },
	});
}
