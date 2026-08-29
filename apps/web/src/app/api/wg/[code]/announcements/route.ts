import { recordAuditEvent } from '@/core/audit';
import {
	announcementComments,
	announcementReactions,
	announcements,
	db,
	wgMembers,
} from '@/core/db';
import { badRequest, serverError, tooMany } from '@/core/errors';
import {
	ReplayCache,
	type ReplayReservation,
	claimReplaySlotWithRetry,
	replayKey,
} from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { getCachedResponse, readIdempotencyKey, setCachedResponse } from '@/core/idempotency';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { imageUrlSchema } from '@/core/validators/image-url';
import {
	ANNOUNCEMENT_KINDS,
	ANNOUNCEMENT_SOURCES,
	summarizeAnnouncementReactions,
} from '@/features/pinnwand/announcement-workflow';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const CONTENT_MIN = 1;
const CONTENT_MAX = 2000;
const ANNOUNCEMENTS_LIST_LIMIT = 300;
const announcementKindSchema = z.enum(ANNOUNCEMENT_KINDS);
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

type AnnouncementCreateResponseBody = { announcement: unknown };

const announcementCreateReplay = new ReplayCache<AnnouncementCreateResponseBody>(
	IDEMPOTENCY_TTL_MS,
);

function announcementCreateIdempotencyScope(wgId: string, memberId: string): string {
	return `announcements-create:${wgId}:${memberId}`;
}

const createAnnouncementSchema = z.object({
	content: z.string().trim().min(CONTENT_MIN).max(CONTENT_MAX),
	imageUrl: imageUrlSchema,
	kind: announcementKindSchema.optional().default('info'),
	source: z.enum(ANNOUNCEMENT_SOURCES).optional().default('manual'),
	sourcePath: z
		.string()
		.trim()
		.max(160)
		.refine((value) => value.length === 0 || value.startsWith('/'))
		.optional()
		.nullable(),
});

export const GET = withWgRoute(
	'announcements GET',
	async (req, { code }) => {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const items = await db
			.select()
			.from(announcements)
			.where(eq(announcements.wgId, wgId))
			.orderBy(sql`${announcements.pinnedAt} desc nulls last`, desc(announcements.createdAt))
			.limit(ANNOUNCEMENTS_LIST_LIMIT);

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
	},
	{
		fixture: () => {
			return NextResponse.json({ announcements: [] });
		},
	},
);

export const POST = withWgRoute('announcements POST', async (req, { code }) => {
	let replayReservation: Extract<
		ReplayReservation<AnnouncementCreateResponseBody>,
		{ owned: true }
	> | null = null;
	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
	}

	const parsed = createAnnouncementSchema.safeParse(raw);
	if (!parsed.success) {
		const { fieldErrors } = parsed.error.flatten();
		if (fieldErrors.kind || fieldErrors.source) return badRequest('kind_invalid');
		if (fieldErrors.sourcePath) return badRequest('source_path_invalid');
		if (fieldErrors.imageUrl) return badRequest('image_invalid');
		return badRequest('content_invalid');
	}

	const { content, imageUrl = null, kind, source, sourcePath = null } = parsed.data;
	const safeImageUrl = typeof imageUrl === 'string' && imageUrl.length > 0 ? imageUrl : null;
	const safeSource = source === 'system' ? 'manual' : source;
	const safeSourcePath =
		safeSource !== 'manual' && typeof sourcePath === 'string' && sourcePath.startsWith('/')
			? sourcePath
			: null;
	const idemKey = readIdempotencyKey(req);
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const idemScope = idemKey
		? announcementCreateIdempotencyScope(wg.id, auth.member.memberId)
		: null;
	const idemReplayKey = idemScope && idemKey ? replayKey(idemScope, idemKey) : null;
	if (idemScope && idemKey && idemReplayKey) {
		const localReplay = announcementCreateReplay.get(idemReplayKey);
		if (localReplay) return NextResponse.json(await localReplay);
		const cached = await getCachedResponse<AnnouncementCreateResponseBody>(idemScope, idemKey);
		if (cached) {
			announcementCreateReplay.remember(idemReplayKey, cached);
			return NextResponse.json(cached);
		}
	}
	const limited = await checkRateLimit(
		wgWriteLimiter,
		`announcement:${wg.id}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	// SECURITY: author is always the authenticated caller. Body-supplied
	// author ids are ignored to prevent impersonation.
	const author = auth.member.memberId;
	const replaySlot =
		idemReplayKey === null ? null : announcementCreateReplay.reserve(idemReplayKey);
	if (replaySlot?.owned === false) return NextResponse.json(await replaySlot.promise);
	replayReservation = replaySlot;

	try {
		if (idemScope && idemKey) {
			const slot = await claimReplaySlotWithRetry<AnnouncementCreateResponseBody>(
				idemScope,
				idemKey,
			);
			if (!slot.won && slot.cached) {
				replayReservation?.resolve(slot.cached);
				return NextResponse.json(slot.cached);
			}
		}
		const [item] = await db
			.insert(announcements)
			.values({
				wgId: wg.id,
				authorMemberId: author,
				content,
				imageUrl: safeImageUrl,
				kind,
				source: safeSource,
				sourcePath: safeSourcePath,
			})
			.returning();
		if (!item) {
			const err = new Error('insert_failed');
			replayReservation?.reject(err);
			return serverError('insert_failed');
		}
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
		void dispatchNotification({
			wg,
			event: 'announcement.posted',
			payload: {
				announcementId: item.id,
				title: content.slice(0, 120),
				actorName: auth.member.name,
			},
			excludeMemberId: auth.member.memberId,
		}).catch((err) => console.error('[announcements POST] notification failed', err));
		const responseBody = { announcement: item };
		if (idemScope && idemKey && replayReservation?.owned) {
			replayReservation.resolve(responseBody);
			void setCachedResponse(idemScope, idemKey, responseBody).catch((err) =>
				console.warn('[announcements POST] idem cache write failed', err),
			);
		}
		return NextResponse.json(responseBody);
	} catch (err) {
		replayReservation?.reject(err);
		throw err;
	}
});
