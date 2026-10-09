import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, wgMembers } from '@/core/db';
import { acceptedSigningSecrets, currentSigningSecret } from '@/core/infra/signing-secrets';
import { eq } from 'drizzle-orm';
import { APP_ORIGIN } from '../statement-mail';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signature(memberId: string, secret: string): string {
	return createHmac('sha256', secret)
		.update(`statement-unsubscribe:${memberId}`)
		.digest('base64url');
}

/** `<memberId>.<hmac>`: lets a mail recipient opt out without logging in. */
export function signUnsubscribeToken(memberId: string, secret = currentSigningSecret()): string {
	if (!secret) throw new Error('MEMBER_SESSION_SECRET is not set');
	return `${memberId}.${signature(memberId, secret)}`;
}

/** The member id of a valid token; `null` for anything tampered, malformed or unverifiable. */
export function verifyUnsubscribeToken(
	token: string,
	secrets: string | null | readonly string[] = acceptedSigningSecrets(),
): string | null {
	const [memberId, mac, ...rest] = token.split('.');
	if (!memberId || !mac || rest.length > 0 || !UUID.test(memberId)) return null;
	const provided = Buffer.from(mac);
	// Every accepted secret is checked, so the time taken does not tell which one matched.
	let valid = false;
	for (const secret of typeof secrets === 'string' ? [secrets] : (secrets ?? [])) {
		const expected = Buffer.from(signature(memberId, secret));
		if (expected.length === provided.length && timingSafeEqual(expected, provided)) valid = true;
	}
	return valid ? memberId : null;
}

export function unsubscribeUrl(memberId: string): string {
	return `${APP_ORIGIN}/api/email/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(memberId))}`;
}

/**
 * Turns the statement mail off for the member and for every other membership of
 * the same account, because the mail's one-click unsubscribe reads as a global
 * opt-out. Idempotent.
 */
export async function disableStatementEmail(memberId: string): Promise<void> {
	const [member] = await db
		.select({ authUserId: wgMembers.authUserId })
		.from(wgMembers)
		.where(eq(wgMembers.id, memberId));
	if (!member) return;
	await db
		.update(wgMembers)
		.set({ notifyStatementEmail: false })
		.where(
			member.authUserId ? eq(wgMembers.authUserId, member.authUserId) : eq(wgMembers.id, memberId),
		);
}
