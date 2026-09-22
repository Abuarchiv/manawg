import { recordAuditEvent } from '@/core/audit';
import { db, pushSubscriptions, wgMembers } from '@/core/db';
import { TransactionAbort, withTransaction } from '@/core/db/transaction';
import { forbidden, notFound, serverError, tooMany } from '@/core/errors';
import { badRequest, payloadTooLarge } from '@/core/errors';
import { withIdempotentJsonResponse } from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { readJsonBody } from '@/core/http/read-json';
import { logApiError } from '@/core/infra/observability';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, notifTestLimiter, wgWriteLimiter } from '@/core/rate-limit';
import {
	pushAuthKeySchema,
	pushEndpointSchema,
	pushP256dhSchema,
} from '@/core/validators/push-endpoint';
import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const patchSchema = z.object({
	pushOptIn: z.boolean().optional(),
	notifyAnnouncements: z.boolean().optional(),
	notifyChores: z.boolean().optional(),
	notifyExpenses: z.boolean().optional(),
	notifyShopping: z.boolean().optional(),
	notifyInventory: z.boolean().optional(),
	notifyReminders: z.boolean().optional(),
	notifyChat: z.boolean().optional(),
	notifyEvents: z.boolean().optional(),
	quietStartHour: z.number().int().min(0).max(23).nullable().optional(),
	quietEndHour: z.number().int().min(0).max(23).nullable().optional(),
});

const postSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('test_notification') }),
	z.object({
		action: z.literal('push_subscribe'),
		endpoint: pushEndpointSchema,
		p256dh: pushP256dhSchema,
		authKey: pushAuthKeySchema,
	}),
	z.object({
		action: z.literal('push_unsubscribe'),
		endpoint: z.string().url(),
	}),
]);

const NOTIFICATION_FIELD_LABELS: Record<string, string> = {
	pushOptIn: 'Web Push',
	notifyAnnouncements: 'Pinnwand',
	notifyChores: 'Putzplan',
	notifyExpenses: 'Ausgaben',
	notifyShopping: 'Einkauf',
	notifyInventory: 'Vorräte',
	notifyReminders: 'Mahnungen',
	notifyChat: 'Chat',
	notifyEvents: 'Termine',
	quietStartHour: 'Ruhezeit Start',
	quietEndHour: 'Ruhezeit Ende',
};

export const GET = withWgRoute('notifications GET', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	const member = await db.query.wgMembers.findFirst({
		where: and(eq(wgMembers.id, auth.member.memberId), eq(wgMembers.wgId, wg.id)),
		columns: {
			pushOptIn: true,
			notifyAnnouncements: true,
			notifyChores: true,
			notifyExpenses: true,
			notifyShopping: true,
			notifyInventory: true,
			notifyReminders: true,
			notifyChat: true,
			notifyEvents: true,
			quietStartHour: true,
			quietEndHour: true,
		},
	});
	if (!member) return notFound('member_not_found');

	return NextResponse.json({
		pushOptIn: member.pushOptIn,
		notifyAnnouncements: member.notifyAnnouncements,
		notifyChores: member.notifyChores,
		notifyExpenses: member.notifyExpenses,
		notifyShopping: member.notifyShopping,
		notifyInventory: member.notifyInventory,
		notifyReminders: member.notifyReminders,
		notifyChat: member.notifyChat,
		notifyEvents: member.notifyEvents,
		quietStartHour: member.quietStartHour,
		quietEndHour: member.quietEndHour,
		pushConfigured: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
	});
});

export const PATCH = withWgRoute('notifications PATCH', async (req, { code }) => {
	const rawResult = await readJsonBody(req, 16 * 1024);
	if (!rawResult.ok)
		return rawResult.reason === 'payload_too_large'
			? payloadTooLarge()
			: badRequest('invalid_json');
	const raw = rawResult.body;
	const parsed = patchSchema.safeParse(raw);
	if (!parsed.success) {
		const { fieldErrors } = parsed.error.flatten();
		if (fieldErrors.quietStartHour || fieldErrors.quietEndHour) {
			return badRequest('quiet_hours_invalid');
		}
		return badRequest('invalid_body');
	}
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	return withIdempotentJsonResponse(
		req,
		`notification-patch:${wg.id}:${auth.member.memberId}`,
		async () => {
			const update: {
				pushOptIn?: boolean;
				notifyAnnouncements?: boolean;
				notifyChores?: boolean;
				notifyExpenses?: boolean;
				notifyShopping?: boolean;
				notifyInventory?: boolean;
				notifyReminders?: boolean;
				notifyChat?: boolean;
				notifyEvents?: boolean;
				quietStartHour?: number | null;
				quietEndHour?: number | null;
			} = {};
			if (typeof parsed.data.pushOptIn === 'boolean') {
				update.pushOptIn = parsed.data.pushOptIn;
			}
			if (typeof parsed.data.notifyAnnouncements === 'boolean') {
				update.notifyAnnouncements = parsed.data.notifyAnnouncements;
			}
			if (typeof parsed.data.notifyChores === 'boolean') {
				update.notifyChores = parsed.data.notifyChores;
			}
			if (typeof parsed.data.notifyExpenses === 'boolean') {
				update.notifyExpenses = parsed.data.notifyExpenses;
			}
			if (typeof parsed.data.notifyShopping === 'boolean') {
				update.notifyShopping = parsed.data.notifyShopping;
			}
			if (typeof parsed.data.notifyInventory === 'boolean') {
				update.notifyInventory = parsed.data.notifyInventory;
			}
			if (typeof parsed.data.notifyReminders === 'boolean') {
				update.notifyReminders = parsed.data.notifyReminders;
			}
			if (typeof parsed.data.notifyChat === 'boolean') {
				update.notifyChat = parsed.data.notifyChat;
			}
			if (typeof parsed.data.notifyEvents === 'boolean') {
				update.notifyEvents = parsed.data.notifyEvents;
			}
			if (parsed.data.quietStartHour !== undefined) {
				update.quietStartHour = parsed.data.quietStartHour;
			}
			if (parsed.data.quietEndHour !== undefined) {
				update.quietEndHour = parsed.data.quietEndHour;
			}
			const changedFields = Object.keys(update);
			if (changedFields.length === 0) return NextResponse.json({ ok: true });

			const [updatedMember] = await db
				.update(wgMembers)
				.set(update)
				.where(and(eq(wgMembers.id, auth.member.memberId), eq(wgMembers.wgId, wg.id)))
				.returning({ id: wgMembers.id });
			if (!updatedMember) return notFound('member_not_found');
			if (update.pushOptIn === false) {
				await db
					.delete(pushSubscriptions)
					.where(eq(pushSubscriptions.memberId, auth.member.memberId));
			}
			await recordAuditEvent({
				wgId: wg.id,
				memberId: auth.member.memberId,
				eventType: 'notification.settings.updated',
				entityType: 'member',
				entityId: auth.member.memberId,
				summary: `${auth.member.name} hat Benachrichtigungseinstellungen geändert.`,
				metadata: {
					notificationFields: changedFields.map(
						(field) => NOTIFICATION_FIELD_LABELS[field] ?? field,
					),
					pushOptIn: typeof update.pushOptIn === 'boolean' ? update.pushOptIn : undefined,
					quietStartHour: update.quietStartHour,
					quietEndHour: update.quietEndHour,
				},
			});
			return NextResponse.json({ ok: true });
		},
	);
});

export const POST = withWgRoute('notifications POST', async (req, { code }) => {
	const rawResult = await readJsonBody(req, 16 * 1024);
	if (!rawResult.ok)
		return rawResult.reason === 'payload_too_large'
			? payloadTooLarge()
			: badRequest('invalid_json');
	const raw = rawResult.body;
	const parsed = postSchema.safeParse(raw);
	if (!parsed.success) {
		const { fieldErrors } = parsed.error.flatten();
		if (fieldErrors.endpoint || fieldErrors.p256dh || fieldErrors.authKey) {
			return badRequest('push_subscription_invalid');
		}
		return badRequest('invalid_body');
	}
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const actionScope =
		parsed.data.action === 'test_notification'
			? 'test'
			: `${parsed.data.action}:${parsed.data.endpoint}`;

	// Throttled BEFORE the idempotent wrapper runs: the wrapper claims a
	// response slot in Postgres for every request, so a subscribe flood would
	// cost one claim row per request even when the callback never executes —
	// enough to fill the subscriptions table's write path ahead of the limiter.
	// Same 30/min ceiling as the middleware, keyed per member on top of it so
	// one member cannot rotate IPs to hammer the subscriptions table. Far above
	// any real opt-in cadence.
	if (parsed.data.action === 'push_subscribe') {
		const subscribeLimit = await checkRateLimit(
			wgWriteLimiter,
			`push-subscribe:${wg.id}:${auth.member.memberId}`,
		);
		if (!subscribeLimit.success) return tooMany();
	}

	return withIdempotentJsonResponse(
		req,
		`notification:${wg.id}:${auth.member.memberId}:${actionScope}`,
		async () => {
			if (parsed.data.action === 'test_notification') {
				const rl = await checkRateLimit(
					notifTestLimiter,
					`notif-test:${wg.id}:${auth.member.memberId}`,
				);
				if (!rl.success) {
					return tooMany('test_notification_rate_limited', 'test_notification_rate_limited');
				}
				try {
					await dispatchNotification({
						wg,
						event: 'notification.test',
						payload: {},
						targetMemberIds: [auth.member.memberId],
						bypassPreferences: true,
					});
				} catch (err) {
					logApiError('[notifications POST] test notification failed', err);
					return serverError(err, 'unexpected_error');
				}
				return NextResponse.json({ ok: true });
			}

			if (parsed.data.action === 'push_subscribe') {
				// Opting in and storing the endpoint are one action, so they are
				// written in one transaction. Previously the flag was set first and
				// undone with a second update when the insert failed — a repair that
				// is itself a database call, and when it failed the member stayed
				// marked as reachable by push with no endpoint behind it, so every
				// notification for them went nowhere.
				//
				// The insert is an upsert on the endpoint's unique index, restricted
				// to rows this member already owns. That closes the race between
				// "does the endpoint exist" and "insert it": a foreign endpoint
				// updates nothing and comes back without a row, which is the 403.
				// Pulled out of `parsed.data` before the callback: TypeScript drops the
				// discriminated-union narrowing inside a closure.
				const { endpoint, p256dh, authKey } = parsed.data;
				try {
					await withTransaction(async (tx) => {
						const [updatedMember] = await tx
							.update(wgMembers)
							.set({ pushOptIn: true })
							.where(and(eq(wgMembers.id, auth.member.memberId), eq(wgMembers.wgId, wg.id)))
							.returning({ id: wgMembers.id });
						if (!updatedMember) throw new TransactionAbort('member_not_found');

						const subscriptionValues = {
							p256dh,
							authKey,
							userAgent: req.headers.get('user-agent'),
						};
						const [saved] = await tx
							.insert(pushSubscriptions)
							.values({
								memberId: auth.member.memberId,
								endpoint,
								...subscriptionValues,
							})
							.onConflictDoUpdate({
								target: pushSubscriptions.endpoint,
								set: subscriptionValues,
								setWhere: eq(pushSubscriptions.memberId, auth.member.memberId),
							})
							.returning({ id: pushSubscriptions.id });
						if (!saved) throw new TransactionAbort('endpoint_owned');
					});
				} catch (subscribeErr) {
					if (subscribeErr instanceof TransactionAbort) {
						if (subscribeErr.code === 'member_not_found') return notFound('member_not_found');
						return forbidden('endpoint_owned', 'endpoint_owned');
					}
					logApiError('[notifications POST] push subscribe failed', subscribeErr);
					return serverError(subscribeErr, 'unexpected_error');
				}
				await recordAuditEvent({
					wgId: wg.id,
					memberId: auth.member.memberId,
					eventType: 'notification.push.subscribed',
					entityType: 'member',
					entityId: auth.member.memberId,
					summary: `${auth.member.name} hat Web Push aktiviert.`,
					metadata: { notificationFields: ['Web Push'], pushOptIn: true },
				});
				return NextResponse.json({ ok: true });
			}

			// push_unsubscribe: same per-member write cap as subscribe above.
			const unsubscribeLimit = await checkRateLimit(
				wgWriteLimiter,
				`push-unsubscribe:${wg.id}:${auth.member.memberId}`,
			);
			if (!unsubscribeLimit.success) return tooMany();

			await db
				.delete(pushSubscriptions)
				.where(
					and(
						eq(pushSubscriptions.endpoint, parsed.data.endpoint),
						eq(pushSubscriptions.memberId, auth.member.memberId),
					),
				);
			const remainingSubscriptions = await db
				.select({ id: pushSubscriptions.id })
				.from(pushSubscriptions)
				.where(eq(pushSubscriptions.memberId, auth.member.memberId))
				.limit(1);
			const pushOptIn = remainingSubscriptions.length > 0;
			const persistedPushOptIn = pushOptIn
				? true
				: sql<boolean>`exists (
					select 1
					from ${pushSubscriptions}
					where ${pushSubscriptions.memberId} = ${auth.member.memberId}
				)`;
			const [updatedMember] = await db
				.update(wgMembers)
				.set({ pushOptIn: persistedPushOptIn })
				.where(and(eq(wgMembers.id, auth.member.memberId), eq(wgMembers.wgId, wg.id)))
				.returning({ id: wgMembers.id, pushOptIn: wgMembers.pushOptIn });
			if (!updatedMember) return notFound('member_not_found');
			const auditedPushOptIn =
				typeof updatedMember.pushOptIn === 'boolean' ? updatedMember.pushOptIn : pushOptIn;
			await recordAuditEvent({
				wgId: wg.id,
				memberId: auth.member.memberId,
				eventType: 'notification.push.unsubscribed',
				entityType: 'member',
				entityId: auth.member.memberId,
				summary: `${auth.member.name} hat Web Push deaktiviert.`,
				metadata: { notificationFields: ['Web Push'], pushOptIn: auditedPushOptIn },
			});
			return NextResponse.json({ ok: true });
		},
	);
});
