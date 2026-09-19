import { db, pushSubscriptions, wgMembers } from '@/core/db';
import { isQuietHoursActive } from '@/core/notifications/notification-preferences';
import {
	type NotificationEvent,
	formatNotificationMessage,
	notificationCategoryForEvent,
	notificationPriorityForEvent,
} from '@/core/notifications/notifications';
import {
	isTransientWebPushStatus,
	parseWebPushStatusCode,
} from '@/core/notifications/web-push-errors';
import { getAppUrl } from '@/shared/lib/app-url';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

export interface DispatchInput {
	wg: { id: string; name: string; shareCode: string };
	event: NotificationEvent;
	payload: Record<string, unknown>;
	targetMemberIds?: string[];
	excludeMemberId?: string;
	bypassPreferences?: boolean;
}

export type NotificationDispatchWarning =
	| null
	| 'notification_delivery_failed'
	| 'notification_delivery_unknown';

export interface DispatchNotificationSafelyOptions {
	timeoutMs?: number;
	dispatch?: typeof dispatchNotification;
}

interface WebPushResult {
	sent: number;
	failures: unknown[];
}

const PUSH_RETRY_DELAYS_MS = [100, 300] as const;

export function buildNotificationUrl(shareCode: string, urlPath: string): string {
	const normalizedPath = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
	return `${getAppUrl()}/wg/${encodeURIComponent(shareCode)}${normalizedPath}`;
}

function resolveVapidSubject(): string {
	const subject = process.env.VAPID_SUBJECT;
	if (subject && subject.length > 0) return subject;
	if (process.env.VERCEL_ENV === 'production') {
		throw new Error('VAPID_SUBJECT must be configured in production');
	}
	return 'mailto:info@manawg.com';
}

async function configureWebPush(): Promise<typeof import('web-push') | null> {
	const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
	const privateKey = process.env.VAPID_PRIVATE_KEY;
	if (!publicKey || !privateKey) return null;
	const webPush = await import('web-push');
	webPush.setVapidDetails(resolveVapidSubject(), publicKey, privateKey);
	return webPush;
}

async function sendWebPush(
	memberId: string,
	payload: { title: string; body: string; url: string },
): Promise<WebPushResult> {
	const webPush = await configureWebPush();
	if (!webPush) return { sent: 0, failures: [] };
	const subs = await db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.memberId, memberId));
	let sent = 0;
	let deletedStaleSubscription = false;
	const failures: unknown[] = [];

	await Promise.allSettled(
		subs.map(async (sub) => {
			try {
				for (let attempt = 0; ; attempt += 1) {
					try {
						await webPush.sendNotification(
							{
								endpoint: sub.endpoint,
								keys: { p256dh: sub.p256dh, auth: sub.authKey },
							},
							JSON.stringify({
								title: payload.title,
								body: payload.body,
								url: payload.url,
								icon: '/icon-192.png',
							}),
						);
						sent += 1;
						break;
					} catch (err) {
						const statusCode = parseWebPushStatusCode(err);
						if (!isTransientWebPushStatus(statusCode) || attempt >= PUSH_RETRY_DELAYS_MS.length) {
							throw err;
						}
						await new Promise((resolve) => setTimeout(resolve, PUSH_RETRY_DELAYS_MS[attempt]));
					}
				}
			} catch (err) {
				const statusCode = parseWebPushStatusCode(err);
				if (statusCode === 404 || statusCode === 410) {
					await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
					deletedStaleSubscription = true;
				} else {
					failures.push(err);
					console.error('[notifications] web push failed', err);
				}
			}
		}),
	);

	if (deletedStaleSubscription) {
		const remainingSubscriptions = await db
			.select({ id: pushSubscriptions.id })
			.from(pushSubscriptions)
			.where(eq(pushSubscriptions.memberId, memberId));
		if (remainingSubscriptions.length === 0) {
			await db
				.update(wgMembers)
				.set({
					pushOptIn: sql<boolean>`exists (
						select 1
						from ${pushSubscriptions}
						where ${pushSubscriptions.memberId} = ${memberId}
					)`,
				})
				.where(eq(wgMembers.id, memberId));
		}
	}

	return { sent, failures };
}

export async function dispatchNotification(
	input: DispatchInput,
): Promise<{ sent: number; failures: unknown[] }> {
	if (input.targetMemberIds?.length === 0) return { sent: 0, failures: [] };

	const rows = await db
		.select({
			id: wgMembers.id,
			deactivatedAt: wgMembers.deactivatedAt,
			pushOptIn: wgMembers.pushOptIn,
			notifyAnnouncements: wgMembers.notifyAnnouncements,
			notifyChores: wgMembers.notifyChores,
			notifyExpenses: wgMembers.notifyExpenses,
						notifyShopping: wgMembers.notifyShopping,
						notifyInventory: wgMembers.notifyInventory,
			notifyReminders: wgMembers.notifyReminders,
			notifyChat: wgMembers.notifyChat,
			notifyEvents: wgMembers.notifyEvents,
			quietStartHour: wgMembers.quietStartHour,
			quietEndHour: wgMembers.quietEndHour,
		})
		.from(wgMembers)
		.where(
			input.targetMemberIds?.length
				? and(
						eq(wgMembers.wgId, input.wg.id),
						inArray(wgMembers.id, input.targetMemberIds),
						isNull(wgMembers.deactivatedAt),
					)
				: and(eq(wgMembers.wgId, input.wg.id), isNull(wgMembers.deactivatedAt)),
		);

	const message = formatNotificationMessage(input.event, {
		...input.payload,
		wgName: input.wg.name,
	});
	const url = buildNotificationUrl(input.wg.shareCode, message.urlPath);
	const category = notificationCategoryForEvent(input.event);
	const priority = notificationPriorityForEvent(input.event);
	if (priority === 'silent') return { sent: 0, failures: [] };
	const currentHour = new Date().getHours();

	const targetMembers = rows
		.filter((member) => member.id !== input.excludeMemberId)
		// Moved-out members never receive push, even when explicitly targeted.
		.filter((member) => member.deactivatedAt == null)
		.filter(
			(member) =>
				input.bypassPreferences ||
				priority === 'urgent' ||
				!isQuietHoursActive(currentHour, member.quietStartHour, member.quietEndHour),
		)
		.filter((member) => {
			if (input.bypassPreferences) return true;
			if (category === 'announcements') return member.notifyAnnouncements;
			if (category === 'chores') return member.notifyChores;
					if (category === 'expenses') return member.notifyExpenses;
					if (category === 'inventory') return member.notifyInventory;
			if (category === 'events') return member.notifyEvents;
			if (category === 'reminders') return member.notifyReminders;
			if (category === 'chat') return member.notifyChat;
			return member.notifyShopping;
		});

	const pushResults = await Promise.allSettled(
		targetMembers.map(async (member) => {
			if (!member.pushOptIn) return { sent: 0, failures: [] };
			return sendWebPush(member.id, { title: message.title, body: message.body, url });
		}),
	);

	const sentTotal = pushResults
		.filter(
			(result): result is PromiseFulfilledResult<{ sent: number; failures: unknown[] }> =>
				result.status === 'fulfilled',
		)
		.reduce((total, result) => total + result.value.sent, 0);
	const failures = pushResults.flatMap((result) =>
		result.status === 'fulfilled' ? result.value.failures : [result.reason],
	);
	if (input.event === 'notification.test' && sentTotal === 0) {
		throw failures[0] ?? new Error('notification_delivery_failed');
	}
	return { sent: sentTotal, failures };
}

const DEFAULT_NOTIFICATION_DISPATCH_TIMEOUT_MS = 5_000;

export async function dispatchNotificationSafely(
	input: DispatchInput,
	options: DispatchNotificationSafelyOptions = {},
): Promise<{ sent: number; warning: NotificationDispatchWarning }> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<never>((_, reject) => {
			timeoutId = setTimeout(
				() => reject(new Error('notification delivery timed out')),
				options.timeoutMs ?? DEFAULT_NOTIFICATION_DISPATCH_TIMEOUT_MS,
			);
		});
		const result = await Promise.race([(options.dispatch ?? dispatchNotification)(input), timeout]);
		return {
			sent: result.sent,
			warning: result.failures.length > 0 ? 'notification_delivery_failed' : null,
		};
	} catch {
		return { sent: 0, warning: 'notification_delivery_unknown' };
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}
}
