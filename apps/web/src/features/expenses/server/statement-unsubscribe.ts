import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, wgMembers } from '@/core/db';
import { eq } from 'drizzle-orm';
import { APP_ORIGIN } from '../statement-mail';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signature(memberId: string, secret: string): string {
	return createHmac('sha256', secret)
		.update(`statement-unsubscribe:${memberId}`)
		.digest('base64url');
}

function secretFromEnv(): string | null {
	return process.env.MEMBER_SESSION_SECRET?.trim() || null;
}

/** `<memberId>.<hmac>`: lets a mail recipient opt out without logging in. */
export function signUnsubscribeToken(memberId: string, secret = secretFromEnv()): string {
	if (!secret) throw new Error('MEMBER_SESSION_SECRET is not set');
	return `${memberId}.${signature(memberId, secret)}`;
}

/** The member id of a valid token; `null` for anything tampered, malformed or unverifiable. */
export function verifyUnsubscribeToken(token: string, secret = secretFromEnv()): string | null {
	if (!secret) return null;
	const [memberId, mac, ...rest] = token.split('.');
	if (!memberId || !mac || rest.length > 0 || !UUID.test(memberId)) return null;
	const expected = Buffer.from(signature(memberId, secret));
	const provided = Buffer.from(mac);
	if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
	return memberId;
}

export function unsubscribeUrl(memberId: string): string {
	return `${APP_ORIGIN}/api/email/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(memberId))}`;
}

/** Turns the statement mail off for the member. Idempotent. */
export async function disableStatementEmail(memberId: string): Promise<void> {
	await db.update(wgMembers).set({ notifyStatementEmail: false }).where(eq(wgMembers.id, memberId));
}
