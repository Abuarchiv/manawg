import { recordAuditEvent } from '@/core/audit';
import { db, wgMembers } from '@/core/db';
import { lockActiveAccountMember } from '@/core/db/account-deletion';
import {
	type IdempotentWriteResult,
	type WriteOutcome,
	type Rejected as WriteRejection,
	rejectWrite,
	responseCodec,
	withIdempotentWrite,
} from '@/core/db/idempotent-write';
import { TransactionAbort, withTransaction } from '@/core/db/transaction';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { forbidden, notFound, serverError, tooMany, unauthorized } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { checkEnv } from '@/core/infra/env';
import { logApiError } from '@/core/infra/observability';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, notifTestLimiter, wgWriteLimiter } from '@/core/rate-limit';
import {
	pushAuthKeySchema,
	pushEndpointSchema,
	pushP256dhSchema,
} from '@/core/validators/push-endpoint';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
	type NotificationSettingsUpdate,
	type NotificationWriter,
	subscribePush,
	unsubscribePush,
	updateNotificationSettings,
} from './notification-writes';

const NOTIFICATION_BODY_BYTES = 16 * 1024;
const notificationCodec = responseCodec();

type Rejected = WriteRejection<NextResponse>;

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
	notifyStatementEmail: z.boolean().optional(),
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
	notifyShopping: 'Einkäufe',
	notifyInventory: 'Vorräte',
	notifyReminders: 'Erinnerungen',
	notifyChat: 'Chat',
	notifyEvents: 'Kalender',
	notifyStatementEmail: 'Monatsabrechnung per E-Mail',
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
			notifyStatementEmail: true,
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
		notifyStatementEmail: member.notifyStatementEmail,
		quietStartHour: member.quietStartHour,
		quietEndHour: member.quietEndHour,
		pushConfigured: !checkEnv(process.env).degraded.some(
			(entry) => entry.feature === 'push-notifications',
		),
	});
});

function memberGate(writer: NotificationWriter): () => Promise<NextResponse | null> {
	return async () => {
		const member = await withTransaction((tx) =>
			lockActiveAccountMember(tx, writer.wgId, writer.memberId, writer.authUserId),
		);
		return member ? null : unauthorized('member_deactivated', 'member_deactivated');
	};
}

function settingsUpdate(data: z.infer<typeof patchSchema>): NotificationSettingsUpdate {
	const update: NotificationSettingsUpdate = {};
	for (const field of [
		'pushOptIn',
		'notifyAnnouncements',
		'notifyChores',
		'notifyExpenses',
		'notifyShopping',
		'notifyInventory',
		'notifyReminders',
		'notifyChat',
		'notifyEvents',
		'notifyStatementEmail',
	] as const) {
		const value = data[field];
		if (typeof value === 'boolean') update[field] = value;
	}
	if (data.quietStartHour !== undefined) update.quietStartHour = data.quietStartHour;
	if (data.quietEndHour !== undefined) update.quietEndHour = data.quietEndHour;
	return update;
}

export const PATCH = withWgRoute('notifications PATCH', async (req, { code }) => {
	const parsed = await parseBody(req, patchSchema, {
		maxBytes: NOTIFICATION_BODY_BYTES,
		fieldErrors: { quietStartHour: 'quiet_hours_invalid', quietEndHour: 'quiet_hours_invalid' },
	});
	if (!parsed.ok) return parsed.response;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const limited = await checkRateLimit(
		wgWriteLimiter,
		`notif-patch:${wg.id}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();
	const writer = { wgId: wg.id, memberId: auth.member.memberId, authUserId: auth.authUserId };
	const update = settingsUpdate(parsed.data);

	const result = await withIdempotentWrite(
		{
			scope: `notification-patch:${wg.id}:${auth.member.memberId}`,
			key: readIdempotencyKey(req),
			codec: notificationCodec,
			beforeReplay: memberGate(writer),
		},
		async (
			tx,
		): Promise<WriteOutcome<unknown, Rejected | { memberName: string; changed: string[] }>> => {
			if (Object.keys(update).length === 0) return { status: 200, body: { ok: true } };
			const member = await updateNotificationSettings(tx, writer, update);
			if (!member) return rejectWrite(unauthorized('member_deactivated', 'member_deactivated'));
			// An unchanged save is not worth an audit row.
			if (member.changed.length === 0) return { status: 200, body: { ok: true } };
			return {
				status: 200,
				body: { ok: true },
				context: { memberName: member.name, changed: member.changed },
			};
		},
	);
	if (result.kind === 'stopped') return result.response;
	if (result.kind === 'written' && result.context) {
		if ('rejected' in result.context) return result.context.rejected;
		await recordAuditEvent({
			wgId: wg.id,
			memberId: auth.member.memberId,
			eventType: 'notification.settings.updated',
			entityType: 'member',
			entityId: auth.member.memberId,
			summary: `${result.context.memberName} hat Benachrichtigungseinstellungen geändert.`,
			metadata: {
				notificationFields: result.context.changed.map(
					(field) => NOTIFICATION_FIELD_LABELS[field] ?? field,
				),
				pushOptIn: typeof update.pushOptIn === 'boolean' ? update.pushOptIn : undefined,
				quietStartHour: update.quietStartHour,
				quietEndHour: update.quietEndHour,
			},
		});
	}
	return NextResponse.json(result.body, { status: result.status });
});

type PushAuditContext = { audit: 'subscribed' | 'unsubscribed'; name: string; pushOptIn: boolean };

export const POST = withWgRoute('notifications POST', async (req, { code }) => {
	const parsed = await parseBody(req, postSchema, {
		maxBytes: NOTIFICATION_BODY_BYTES,
		fieldErrors: {
			endpoint: 'push_subscription_invalid',
			p256dh: 'push_subscription_invalid',
			authKey: 'push_subscription_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const writer = { wgId: wg.id, memberId: auth.member.memberId, authUserId: auth.authUserId };
	const action = parsed.data;
	const requestEndpoint = 'endpoint' in action ? action.endpoint : '';
	const actionScope =
		action.action === 'test_notification' ? 'test' : `${action.action}:${requestEndpoint}`;

	if (action.action === 'push_subscribe') {
		const subscribeLimit = await checkRateLimit(
			wgWriteLimiter,
			`push-subscribe:${wg.id}:${auth.member.memberId}`,
		);
		if (!subscribeLimit.success) return tooMany();
	}

	type PostContext = Rejected | PushAuditContext;
	let result: IdempotentWriteResult<WriteOutcome<unknown, PostContext>, NextResponse>;
	try {
		result = await withIdempotentWrite<WriteOutcome<unknown, PostContext>, undefined, NextResponse>(
			{
				scope: `notification:${wg.id}:${auth.member.memberId}:${actionScope}`,
				key: readIdempotencyKey(req),
				codec: notificationCodec,
				beforeReplay: memberGate(writer),
			},
			async (tx) => {
				if (action.action === 'test_notification') {
					const rl = await checkRateLimit(
						notifTestLimiter,
						`notif-test:${wg.id}:${auth.member.memberId}`,
					);
					if (!rl.success) {
						return rejectWrite(
							tooMany('test_notification_rate_limited', 'test_notification_rate_limited'),
						);
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
						return rejectWrite(serverError(err, 'unexpected_error'));
					}
					return { status: 200, body: { ok: true } };
				}
				if (action.action === 'push_subscribe') {
					const member = await subscribePush(tx, writer, {
						endpoint: action.endpoint,
						p256dh: action.p256dh,
						authKey: action.authKey,
						userAgent: req.headers.get('user-agent'),
					});
					return {
						status: 200,
						body: { ok: true },
						context: { audit: 'subscribed', name: member.name, pushOptIn: true },
					};
				}
				const unsubscribeLimit = await checkRateLimit(
					wgWriteLimiter,
					`push-unsubscribe:${wg.id}:${auth.member.memberId}`,
				);
				if (!unsubscribeLimit.success) return rejectWrite(tooMany());
				const removed = await unsubscribePush(tx, writer, requestEndpoint);
				if (!removed) return rejectWrite(unauthorized('member_deactivated', 'member_deactivated'));
				return {
					status: 200,
					body: { ok: true, endpointInUse: removed.endpointInUse },
					context: { audit: 'unsubscribed', name: removed.name, pushOptIn: removed.pushOptIn },
				};
			},
		);
	} catch (err) {
		if (action.action !== 'push_subscribe') throw err;
		if (err instanceof TransactionAbort && err.code === 'member_deactivated') {
			return unauthorized('member_deactivated', 'member_deactivated');
		}
		if (err instanceof TransactionAbort && err.code === 'endpoint_owned') {
			return forbidden('endpoint_owned', 'endpoint_owned');
		}
		logApiError('[notifications POST] push subscribe failed', err);
		return serverError(err, 'unexpected_error');
	}
	if (result.kind === 'stopped') return result.response;
	if (result.kind === 'written' && result.context) {
		if ('rejected' in result.context) return result.context.rejected;
		const subscribed = result.context.audit === 'subscribed';
		await recordAuditEvent({
			wgId: wg.id,
			memberId: auth.member.memberId,
			eventType: subscribed ? 'notification.push.subscribed' : 'notification.push.unsubscribed',
			entityType: 'member',
			entityId: auth.member.memberId,
			summary: `${result.context.name} hat Web Push ${subscribed ? 'aktiviert' : 'deaktiviert'}.`,
			metadata: { notificationFields: ['Web Push'], pushOptIn: result.context.pushOptIn },
		});
	}
	return NextResponse.json(result.body, { status: result.status });
});
