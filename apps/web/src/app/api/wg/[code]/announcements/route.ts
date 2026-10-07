import { recordAuditEvent } from '@/core/audit';
import {
	announcementComments,
	announcementReactions,
	announcements,
	chores,
	db,
	wgMembers,
} from '@/core/db';
import { assertPrivateImageCanBeAttached } from '@/core/db/private-image-deletions';
import { TransactionAbort } from '@/core/db/transaction';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, conflict } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { logApiError } from '@/core/infra/observability';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { imageUrlSchema, isAllowedImageUrlForWg } from '@/core/validators/image-url';
import {
	type AnnouncementReplayResponse,
	persistAnnouncementReplayWarning,
	withAnnouncementReplay,
} from '@/features/pinnwand/announcement-replay';
import {
	ANNOUNCEMENT_KINDS,
	ANNOUNCEMENT_SOURCES,
	type AnnouncementSource,
	summarizeAnnouncementReactions,
} from '@/features/pinnwand/announcement-workflow';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const CONTENT_MIN = 1;
const CONTENT_MAX = 2000;
const ANNOUNCEMENTS_LIST_LIMIT = 300;
/** Sources a member writes by hand; everything else is a system notice. */
const MEMBER_ANNOUNCEMENT_SOURCES: AnnouncementSource[] = ['manual', 'chore_swap'];
const announcementKindSchema = z.enum(ANNOUNCEMENT_KINDS);

type AnnouncementCreateWarning =
	| null
	| 'notification_delivery_failed'
	| 'notification_delivery_unknown';

function announcementCreateIdempotencyScope(wgId: string, memberId: string): string {
	return `announcements-create:${wgId}:${memberId}`;
}

function legacyCreateReplay(value: unknown): AnnouncementReplayResponse | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const body = value as { announcement?: unknown; warning?: unknown };
	if (!body.announcement || typeof body.announcement !== 'object') return null;
	const id = (body.announcement as { id?: unknown }).id;
	if (typeof id !== 'string') return null;
	if (
		body.warning !== null &&
		body.warning !== 'notification_delivery_failed' &&
		body.warning !== 'notification_delivery_unknown'
	)
		return null;
	return { status: 200, body: value, entityId: id };
}

const createAnnouncementSchema = z.object({
	content: z.string().trim().min(CONTENT_MIN).max(CONTENT_MAX),
	imageUrl: imageUrlSchema,
	kind: announcementKindSchema.optional().default('info'),
	source: z.enum(ANNOUNCEMENT_SOURCES).optional().default('manual'),
	// Only a swap request may carry a provenance, and only for a chore the
	// server verifies. `sourcePath` is accepted for queued clients but only its
	// chore id is used; the stored path is always rebuilt server-side.
	choreId: z.string().uuid().optional(),
	sourcePath: z
		.string()
		.trim()
		.max(160)
		.refine((value) => value.length === 0 || value.startsWith('/'))
		.optional()
		.nullable(),
});

const CHORE_SWAP_PATH_RE =
	/^\/putzen\?highlight=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function requestedSwapChoreId(
	source: AnnouncementSource,
	choreId: string | undefined,
	sourcePath: string | null,
): string | null {
	if (source !== 'chore_swap') return null;
	return choreId ?? CHORE_SWAP_PATH_RE.exec(sourcePath ?? '')?.[1] ?? null;
}

function choreSwapSourcePath(choreId: string): string {
	return `/putzen?highlight=${encodeURIComponent(choreId)}`;
}

export const GET = withWgRoute('announcements GET', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const listOrder = [
		sql`${announcements.pinnedAt} desc nulls last`,
		desc(announcements.createdAt),
	] as const;
	// System notices (postSystemNotice) are stored as open posts too and can
	// flood the newest window, so open posts written by members are fetched
	// separately and always included next to the newest rows.
	const [newestItems, openMemberItems] = await Promise.all([
		db
			.select()
			.from(announcements)
			.where(eq(announcements.wgId, wgId))
			.orderBy(...listOrder)
			.limit(ANNOUNCEMENTS_LIST_LIMIT),
		db
			.select()
			.from(announcements)
			.where(
				and(
					eq(announcements.wgId, wgId),
					eq(announcements.status, 'open'),
					inArray(announcements.source, MEMBER_ANNOUNCEMENT_SOURCES),
				),
			)
			.orderBy(...listOrder)
			.limit(ANNOUNCEMENTS_LIST_LIMIT),
	]);
	const itemsById = new Map(newestItems.map((item) => [item.id, item]));
	for (const item of openMemberItems) itemsById.set(item.id, item);
	const items = [...itemsById.values()].sort(
		(a, b) =>
			(b.pinnedAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
				(a.pinnedAt?.getTime() ?? Number.NEGATIVE_INFINITY) ||
			b.createdAt.getTime() - a.createdAt.getTime(),
	);

	if (items.length === 0) return NextResponse.json({ announcements: [] });

	const ids = items.map((item) => item.id);
	const reactions = await db
		.select({
			announcementId: announcementReactions.announcementId,
			memberId: announcementReactions.memberId,
			reaction: announcementReactions.reaction,
			memberName: wgMembers.name,
			memberColor: wgMembers.color,
		})
		.from(announcementReactions)
		.innerJoin(wgMembers, eq(announcementReactions.memberId, wgMembers.id))
		.where(inArray(announcementReactions.announcementId, ids));
	const comments = await db
		.select({
			id: announcementComments.id,
			announcementId: announcementComments.announcementId,
			memberId: announcementComments.memberId,
			content: announcementComments.content,
			createdAt: announcementComments.createdAt,
			authorName: wgMembers.name,
			authorColor: wgMembers.color,
		})
		.from(announcementComments)
		.innerJoin(wgMembers, eq(announcementComments.memberId, wgMembers.id))
		.where(inArray(announcementComments.announcementId, ids))
		.orderBy(asc(announcementComments.createdAt));
	const reactionSummary = summarizeAnnouncementReactions(reactions, auth.member.memberId);
	const commentsByAnnouncement = new Map<string, typeof comments>();
	for (const comment of comments) {
		const list = commentsByAnnouncement.get(comment.announcementId) ?? [];
		list.push(comment);
		commentsByAnnouncement.set(comment.announcementId, list);
	}
	const takersByAnnouncement = new Map<
		string,
		Array<{ memberId: string; name: string; color: string | null }>
	>();
	for (const reaction of reactions) {
		if (reaction.reaction !== 'take') continue;
		const list = takersByAnnouncement.get(reaction.announcementId) ?? [];
		list.push({
			memberId: reaction.memberId,
			name: reaction.memberName,
			color: reaction.memberColor,
		});
		takersByAnnouncement.set(reaction.announcementId, list);
	}

	return NextResponse.json({
		announcements: items.map((item) => ({
			...item,
			reactionCounts: reactionSummary.get(item.id)?.reactionCounts ?? {},
			myReactions: reactionSummary.get(item.id)?.myReactions ?? [],
			takers: takersByAnnouncement.get(item.id) ?? [],
			comments: commentsByAnnouncement.get(item.id) ?? [],
		})),
	});
});

export const POST = withWgRoute('announcements POST', async (req, { code }) => {
	const parsed = await parseBody(req, createAnnouncementSchema, {
		maxBytes: 64 * 1024,
		fieldErrors: {
			kind: 'kind_invalid',
			source: 'kind_invalid',
			sourcePath: 'source_path_invalid',
			imageUrl: 'image_invalid',
		},
		invalid: 'content_invalid',
	});
	if (!parsed.ok) return parsed.response;

	const { content, imageUrl = null, kind, source, choreId, sourcePath = null } = parsed.data;
	const safeImageUrl = typeof imageUrl === 'string' && imageUrl.length > 0 ? imageUrl : null;
	const swapChoreId = requestedSwapChoreId(source, choreId, sourcePath);
	// SECURITY: system/expense/shopping provenance is server-generated only.
	let safeSource: AnnouncementSource = 'manual';
	let safeSourcePath: string | null = null;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	if (!isAllowedImageUrlForWg(safeImageUrl, wg.id)) return badRequest('image_invalid');
	const scope = announcementCreateIdempotencyScope(wg.id, auth.member.memberId);

	// SECURITY: author is always the authenticated caller.
	let outcome: {
		response: AnnouncementReplayResponse;
		effect: typeof announcements.$inferSelect | null;
		key: string | null;
	};
	try {
		outcome = await withAnnouncementReplay(
			req,
			scope,
			async (tx) => {
				const limited = await checkRateLimit(
					wgWriteLimiter,
					`announcement:${wg.id}:${auth.member.memberId}`,
				);
				if (!limited.success) {
					return { response: { status: 429, body: { error: 'too_many_requests' } }, effect: null };
				}
				await assertPrivateImageCanBeAttached(tx, wg.id, safeImageUrl);
				if (swapChoreId) {
					const [chore] = await tx
						.select({ id: chores.id })
						.from(chores)
						.where(and(eq(chores.wgId, wg.id), eq(chores.id, swapChoreId)))
						.limit(1);
					if (chore) {
						safeSource = 'chore_swap';
						safeSourcePath = choreSwapSourcePath(chore.id);
						// One open swap request per chore: a repeated request (other member,
						// second tab, offline retry) returns the existing post instead of a duplicate.
						const [existing] = await tx
							.select()
							.from(announcements)
							.where(
								and(
									eq(announcements.wgId, wg.id),
									eq(announcements.source, 'chore_swap'),
									eq(announcements.sourcePath, safeSourcePath),
									eq(announcements.status, 'open'),
								),
							)
							.limit(1);
						if (existing) {
							return {
								response: {
									status: 200,
									body: { announcement: existing, warning: null, duplicate: true },
									entityId: existing.id,
								},
								effect: null,
							};
						}
					}
				}

				const [item] = await tx
					.insert(announcements)
					.values({
						wgId: wg.id,
						authorMemberId: auth.member.memberId,
						content,
						imageUrl: safeImageUrl,
						kind,
						source: safeSource,
						sourcePath: safeSourcePath,
					})
					.returning();
				if (!item) throw new Error('announcement_insert_failed');
				return {
					response: {
						status: 200,
						body: { announcement: item, warning: null },
						entityId: item.id,
					},
					effect: item,
				};
			},
			legacyCreateReplay,
			wg.id,
		);
	} catch (error) {
		if (error instanceof TransactionAbort && error.code === 'image_removed') {
			return conflict('image_removed', 'image_removed');
		}
		throw error;
	}
	if (!outcome.effect) {
		return NextResponse.json(outcome.response.body, { status: outcome.response.status });
	}

	const item = outcome.effect;
	await recordAuditEvent({
		wgId: wg.id,
		memberId: auth.member.memberId,
		eventType: 'announcement.created',
		entityType: 'announcement',
		entityId: item.id,
		summary: `${auth.member.name} hat einen Pinnwand-Beitrag erstellt.`,
		metadata: {
			contentPreview: content.slice(0, 120),
			kind,
			source: safeSource,
			hasImage: Boolean(safeImageUrl),
		},
	});

	let warning: AnnouncementCreateWarning = null;
	try {
		const delivery = await dispatchNotificationSafely({
			wg,
			event: 'announcement.posted',
			payload: {
				announcementId: item.id,
				title: content.slice(0, 120),
				actorName: auth.member.name,
			},
			excludeMemberId: auth.member.memberId,
		});
		warning = delivery.warning;
	} catch (err) {
		logApiError('[announcements POST] post-commit notification failed', err);
	}
	if (warning && outcome.key) {
		try {
			if (!(await persistAnnouncementReplayWarning(scope, outcome.key, item.id, warning))) {
				logApiError(
					'[announcements POST] replay warning persistence failed',
					new Error('replay_row_missing'),
				);
				warning = null;
			}
		} catch (err) {
			logApiError('[announcements POST] replay warning persistence failed', err);
			warning = null;
		}
	}
	return NextResponse.json({ announcement: item, warning });
});
