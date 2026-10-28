import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, wgMembers } from '@/core/db';
import { acceptedSigningSecrets, currentSigningSecret } from '@/core/infra/signing-secrets';
import { type Locale, resolveLocale } from '@/shared/i18n/locale';
import { eq } from 'drizzle-orm';
import { APP_ORIGIN } from './brand-mail';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which optional mail an unsubscribe link turns off. */
const UNSUBSCRIBE_KINDS = ['statement', 'reminders'] as const;
export type UnsubscribeKind = (typeof UNSUBSCRIBE_KINDS)[number];

export interface UnsubscribeToken {
	memberId: string;
	kind: UnsubscribeKind;
}

function isKind(value: string): value is UnsubscribeKind {
	return (UNSUBSCRIBE_KINDS as readonly string[]).includes(value);
}

function signature(memberId: string, kind: UnsubscribeKind, secret: string): string {
	return createHmac('sha256', secret).update(`${kind}-unsubscribe:${memberId}`).digest('base64url');
}

/**
 * `<memberId>.<hmac>` for statements (the format already in sent mails) and
 * `<memberId>.<kind>.<hmac>` for the other kinds: lets a recipient opt out
 * without logging in.
 */
export function signUnsubscribeToken(
	memberId: string,
	kind: UnsubscribeKind = 'statement',
	secret = currentSigningSecret(),
): string {
	if (!secret) throw new Error('MEMBER_SESSION_SECRET is not set');
	const mac = signature(memberId, kind, secret);
	return kind === 'statement' ? `${memberId}.${mac}` : `${memberId}.${kind}.${mac}`;
}

/** The member and kind of a valid token; `null` for anything tampered, malformed or unverifiable. */
export function verifyUnsubscribeToken(
	token: string,
	secrets: string | null | readonly string[] = acceptedSigningSecrets(),
): UnsubscribeToken | null {
	const parts = token.split('.');
	const memberId = parts[0] ?? '';
	const kind = parts.length === 3 ? (parts[1] ?? '') : 'statement';
	const mac = parts.length === 3 ? parts[2] : parts.length === 2 ? parts[1] : undefined;
	if (!mac || !UUID.test(memberId) || !isKind(kind)) return null;
	const provided = Buffer.from(mac);
	// Every accepted secret is checked, so the time taken does not tell which one matched.
	let valid = false;
	for (const secret of typeof secrets === 'string' ? [secrets] : (secrets ?? [])) {
		const expected = Buffer.from(signature(memberId, kind, secret));
		if (expected.length === provided.length && timingSafeEqual(expected, provided)) valid = true;
	}
	return valid ? { memberId, kind } : null;
}

export function unsubscribeUrl(memberId: string, kind: UnsubscribeKind = 'statement'): string {
	return `${APP_ORIGIN}/api/email/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(memberId, kind))}`;
}

/** The member's stored language; `null` when the member is unknown or the lookup fails. */
export async function memberLocale(memberId: string): Promise<Locale | null> {
	try {
		const [row] = await db
			.select({ locale: wgMembers.locale })
			.from(wgMembers)
			.where(eq(wgMembers.id, memberId));
		return row ? resolveLocale({ cookie: row.locale }) : null;
	} catch {
		return null;
	}
}

const PREFERENCE_KEY = {
	statement: 'notifyStatementEmail',
	reminders: 'notifyReminders',
} as const;

/**
 * Turns the mail kind off for the member and for every other membership of the
 * same account, because a one-click unsubscribe reads as a global opt-out.
 * Idempotent.
 */
export async function disableMailKind(memberId: string, kind: UnsubscribeKind): Promise<void> {
	const [member] = await db
		.select({ authUserId: wgMembers.authUserId })
		.from(wgMembers)
		.where(eq(wgMembers.id, memberId));
	if (!member) return;
	await db
		.update(wgMembers)
		.set({ [PREFERENCE_KEY[kind]]: false })
		.where(
			member.authUserId ? eq(wgMembers.authUserId, member.authUserId) : eq(wgMembers.id, memberId),
		);
}
