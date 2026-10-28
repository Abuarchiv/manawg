import { and, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { pushSubscriptions, wgMembers } from '@/core/db';
import { type ActiveAccountMember, lockActiveAccountMember } from '@/core/db/account-deletion';
import { type DbTransaction, TransactionAbort } from '@/core/db/transaction';

const MAX_PUSH_SUBSCRIPTIONS_PER_MEMBER = 10;

/** Who is writing: the member row is locked against a concurrent move-out or account deletion. */
export interface NotificationWriter {
	wgId: string;
	memberId: string;
	authUserId: string;
}

export interface NotificationSettingsUpdate {
	pushOptIn?: boolean;
	notifyAnnouncements?: boolean;
	notifyChores?: boolean;
	notifyExpenses?: boolean;
	notifyShopping?: boolean;
	notifyInventory?: boolean;
	notifyReminders?: boolean;
	notifyChat?: boolean;
	notifyEvents?: boolean;
	notifyStatementEmail?: boolean;
	quietStartHour?: number | null;
	quietEndHour?: number | null;
}

function lockWriter(tx: DbTransaction, writer: NotificationWriter) {
	return lockActiveAccountMember(tx, writer.wgId, writer.memberId, writer.authUserId);
}

/**
 * Store the settings; `null` when the member moved out or the account is being deleted.
 * `changed` lists the fields whose stored value actually differed.
 */
export async function updateNotificationSettings(
	tx: DbTransaction,
	writer: NotificationWriter,
	update: NotificationSettingsUpdate,
): Promise<(ActiveAccountMember & { changed: string[] }) | null> {
	const current = await lockWriter(tx, writer);
	if (!current) return null;
	const fields = Object.keys(update) as (keyof NotificationSettingsUpdate)[];
	const [before] = await tx
		.select(Object.fromEntries(fields.map((field) => [field, wgMembers[field]])))
		.from(wgMembers)
		.where(and(eq(wgMembers.id, current.id), eq(wgMembers.wgId, writer.wgId)))
		.limit(1);
	const changed = fields.filter((field) => before?.[field] !== update[field]);
	const [updated] = await tx
		.update(wgMembers)
		.set(update)
		.where(and(eq(wgMembers.id, current.id), eq(wgMembers.wgId, writer.wgId)))
		.returning({ id: wgMembers.id });
	if (!updated) return null;
	if (update.pushOptIn === false) {
		await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.memberId, current.id));
	}
	return { ...current, changed };
}

/**
 * Store a browser push subscription for the member. Aborts with `member_deactivated`, or with
 * `endpoint_owned` when another account's active member uses the same endpoint.
 */
export async function subscribePush(
	tx: DbTransaction,
	writer: NotificationWriter,
	subscription: { endpoint: string; p256dh: string; authKey: string; userAgent: string | null },
): Promise<ActiveAccountMember> {
	const { endpoint, ...keys } = subscription;
	const current = await lockWriter(tx, writer);
	if (!current) throw new TransactionAbort('member_deactivated');
	const [updatedMember] = await tx
		.update(wgMembers)
		.set({ pushOptIn: true })
		.where(and(eq(wgMembers.id, current.id), eq(wgMembers.wgId, writer.wgId)))
		.returning({ id: wgMembers.id });
	if (!updatedMember) throw new TransactionAbort('member_deactivated');
	// Serializes concurrent subscriptions of the same endpoint from different accounts; the
	// unique index only covers (member_id, endpoint).
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`push-endpoint:${endpoint}`}))`);
	// One browser endpoint serves every WG of the same account. Another account's active member
	// keeps it to itself (403): its notifications must not reach this browser and vice versa.
	// Rows of moved-out members are stale and dropped.
	const [foreignOwner] = await tx
		.select({ id: pushSubscriptions.id })
		.from(pushSubscriptions)
		.innerJoin(wgMembers, eq(wgMembers.id, pushSubscriptions.memberId))
		.where(
			and(
				eq(pushSubscriptions.endpoint, endpoint),
				isNull(wgMembers.deactivatedAt),
				or(isNull(wgMembers.authUserId), ne(wgMembers.authUserId, writer.authUserId)),
			),
		)
		.limit(1);
	if (foreignOwner) throw new TransactionAbort('endpoint_owned');
	await tx
		.delete(pushSubscriptions)
		.where(
			and(
				eq(pushSubscriptions.endpoint, endpoint),
				inArray(
					pushSubscriptions.memberId,
					tx.select({ id: wgMembers.id }).from(wgMembers).where(isNotNull(wgMembers.deactivatedAt)),
				),
			),
		);
	await tx
		.insert(pushSubscriptions)
		.values({ memberId: current.id, endpoint, ...keys })
		.onConflictDoUpdate({
			target: [pushSubscriptions.memberId, pushSubscriptions.endpoint],
			set: { ...keys, createdAt: sql`now()` },
		});
	// Keep the newest MAX_PUSH_SUBSCRIPTIONS_PER_MEMBER; the member row lock serializes writers.
	await tx
		.delete(pushSubscriptions)
		.where(
			and(
				eq(pushSubscriptions.memberId, current.id),
				notInArray(
					pushSubscriptions.id,
					tx
						.select({ id: pushSubscriptions.id })
						.from(pushSubscriptions)
						.where(eq(pushSubscriptions.memberId, current.id))
						.orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id))
						.limit(MAX_PUSH_SUBSCRIPTIONS_PER_MEMBER),
				),
			),
		);
	return current;
}

/**
 * Drop the member's subscription for `endpoint`. `pushOptIn` follows whether the member keeps
 * another subscription; `endpointInUse` tells the browser to keep its subscription because
 * another WG of the account still uses it. `null` when the member moved out.
 */
export async function unsubscribePush(
	tx: DbTransaction,
	writer: NotificationWriter,
	endpoint: string,
): Promise<{ name: string; pushOptIn: boolean; endpointInUse: boolean } | null> {
	const current = await lockWriter(tx, writer);
	if (!current) return null;
	await tx
		.delete(pushSubscriptions)
		.where(
			and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.memberId, current.id)),
		);
	const remaining = await tx
		.select({ id: pushSubscriptions.id })
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.memberId, current.id))
		.limit(1);
	const pushOptIn =
		remaining.length > 0
			? true
			: sql<boolean>`exists (select 1 from ${pushSubscriptions} where ${pushSubscriptions.memberId} = ${current.id})`;
	const [updatedMember] = await tx
		.update(wgMembers)
		.set({ pushOptIn })
		.where(and(eq(wgMembers.id, current.id), eq(wgMembers.wgId, writer.wgId)))
		.returning({ pushOptIn: wgMembers.pushOptIn });
	if (!updatedMember) return null;
	const [otherUse] = await tx
		.select({ id: pushSubscriptions.id })
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.endpoint, endpoint))
		.limit(1);
	return {
		name: current.name,
		pushOptIn: updatedMember.pushOptIn,
		endpointInUse: otherUse !== undefined,
	};
}
