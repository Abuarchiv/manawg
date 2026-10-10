import { createHash } from 'node:crypto';
import { recordAuditEvent } from '@/core/audit';
import { db, wgMembers, wgs } from '@/core/db';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { conflict, serviceUnavailable, tooMany } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { sendMail } from '@/core/mail/send-mail';
import { renderInvitationMail } from '@/core/mail/templates';
import { checkRateLimit, inviteMailLimiter } from '@/core/rate-limit';
import { berlinDayKey } from '@/core/utils/berlin-day';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const postSchema = z.object({
	email: z.string().trim().toLowerCase().email().max(254),
});

/**
 * E6: a member invites someone by address. The mail carries the share code
 * and link the card already shows; the address itself is not stored, only a
 * hash in the dedupe key (one mail per address, WG and day).
 */
export const POST = withWgRoute('invitations POST', async (req, { code }) => {
	const parsed = await parseBody(req, postSchema, { fieldErrors: { email: 'email_invalid' } });
	if (!parsed.ok) return parsed.response;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	const rl = await checkRateLimit(inviteMailLimiter, `invite-mail:${auth.member.memberId}`);
	if (!rl.success) return tooMany('invite_rate_limited', 'invite_rate_limited');

	const [[access], members] = await Promise.all([
		db.select({ joiningEnabled: wgs.joiningEnabled }).from(wgs).where(eq(wgs.id, wg.id)).limit(1),
		db
			.select({ name: wgMembers.name })
			.from(wgMembers)
			.where(and(eq(wgMembers.wgId, wg.id), isNull(wgMembers.deactivatedAt)))
			.orderBy(asc(wgMembers.createdAt)),
	]);
	if (!access?.joiningEnabled) return conflict('joining_disabled', 'joining_disabled');

	const emailHash = createHash('sha256').update(parsed.data.email).digest('hex').slice(0, 32);
	let result: Awaited<ReturnType<typeof sendMail>>;
	try {
		result = await sendMail({
			kind: 'invitation',
			dedupeKey: `invite:${wg.id}:${emailHash}:${berlinDayKey(new Date())}`,
			to: parsed.data.email,
			wgId: wg.id,
			memberId: auth.member.memberId,
			mail: renderInvitationMail({
				inviterName: auth.member.name,
				wgName: wg.name,
				shareCode: wg.shareCode,
				memberNames: members.map((member) => member.name),
			}),
		});
	} catch {
		return serviceUnavailable('mail_unavailable', 'mail_unavailable');
	}
	if (result === 'failed' || result === 'deferred') {
		return serviceUnavailable('mail_unavailable', 'mail_unavailable');
	}
	if (result === 'sent') {
		await recordAuditEvent({
			wgId: wg.id,
			memberId: auth.member.memberId,
			eventType: 'member.invited',
			entityType: 'member',
			entityId: auth.member.memberId,
			summary: `${auth.member.name} hat eine Einladung per E-Mail verschickt.`,
		});
	}
	return NextResponse.json({ status: result });
});
