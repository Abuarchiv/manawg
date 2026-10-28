import { createHash } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordAuditEvent } from '@/core/audit';
import { db, wgInvites, wgMembers } from '@/core/db';
import { createWgInvite } from '@/core/db/wg-invites';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { conflict, rateLimitResponse, serviceUnavailable } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { requestLocale } from '@/core/i18n/request-locale';
import { sendMail } from '@/core/mail/send-mail';
import { renderInvitationMail } from '@/core/mail/templates';
import {
	checkRateLimit,
	inviteMailAccountLimiter,
	inviteMailLimiter,
	inviteMailRecipientLimiter,
} from '@/core/rate-limit';
import { berlinDayKey } from '@/core/utils/berlin-day';

const postSchema = z.object({
	email: z.string().trim().toLowerCase().email().max(254),
});

async function revokeInvite(id: string): Promise<void> {
	await db.update(wgInvites).set({ revokedAt: new Date() }).where(eq(wgInvites.id, id));
}

/**
 * E6: a member invites someone by address. The mail carries a fresh invitation
 * link (7 days); the address itself is not stored, only a hash in the dedupe
 * key (one mail per address, WG and day). A link whose mail was not sent is
 * revoked again, so a duplicate or failure leaves no live token behind. A mail
 * whose delivery is unconfirmed (provider timeout) may have arrived, so its
 * link stays valid.
 */
export const POST = withWgRoute('invitations POST', async (req, { code }) => {
	const parsed = await parseBody(req, postSchema, { fieldErrors: { email: 'email_invalid' } });
	if (!parsed.ok) return parsed.response;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	const emailHash = createHash('sha256').update(parsed.data.email).digest('hex').slice(0, 32);
	// Per member, per account (all WGs) and per recipient (all WGs); a limiter outage answers 503.
	for (const [limiter, key] of [
		[inviteMailLimiter, `invite-mail:${auth.member.memberId}`],
		[inviteMailAccountLimiter, `invite-mail-account:${auth.authUserId}`],
		[inviteMailRecipientLimiter, `invite-mail-recipient:${emailHash}`],
	] as const) {
		const limited = rateLimitResponse(
			await checkRateLimit(limiter, key),
			'invite_rate_limited',
			'invite_rate_limited',
		);
		if (limited) return limited;
	}

	const members = await db
		.select({ name: wgMembers.name })
		.from(wgMembers)
		.where(and(eq(wgMembers.wgId, wg.id), isNull(wgMembers.deactivatedAt)))
		.orderBy(asc(wgMembers.createdAt));

	const invite = await createWgInvite(wg.id, auth.member.memberId);
	if (!invite) return conflict('invite_limit_reached', 'invite_limit_reached');
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
				inviteToken: invite.token,
				memberNames: members.map((member) => member.name),
				locale: requestLocale(req),
			}),
		});
	} catch {
		await revokeInvite(invite.id);
		return serviceUnavailable('mail_unavailable', 'mail_unavailable');
	}
	if (result !== 'sent' && result !== 'unconfirmed') await revokeInvite(invite.id);
	if (result === 'failed' || result === 'deferred') {
		return serviceUnavailable('mail_unavailable', 'mail_unavailable');
	}
	if (result === 'sent' || result === 'unconfirmed') {
		await recordAuditEvent({
			wgId: wg.id,
			memberId: auth.member.memberId,
			eventType: 'member.invited',
			entityType: 'member',
			entityId: auth.member.memberId,
			actorName: auth.member.name,
		});
	}
	return NextResponse.json({ status: result });
});
