import 'server-only';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';

/** Tells the other party of a settlement that it was recorded. */
export function notifySettlement(input: {
	wg: { id: string; name: string; shareCode: string };
	actor: { memberId: string; name: string };
	otherMemberId: string;
	amountCents: number;
	currency: string;
	/** `paid`: the actor paid the other party; `received`: the actor confirmed receiving money. */
	direction: 'paid' | 'received';
}) {
	return dispatchNotificationSafely({
		wg: input.wg,
		event: 'expense.debt_settled',
		payload: {
			actorName: input.actor.name,
			amountCents: input.amountCents,
			currency: input.currency,
			direction: input.direction,
		},
		targetMemberIds: [input.otherMemberId],
		excludeMemberId: input.actor.memberId,
	});
}
