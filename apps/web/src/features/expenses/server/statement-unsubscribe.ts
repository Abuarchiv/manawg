import 'server-only';
import {
	unsubscribeUrl as url,
	type UnsubscribeToken,
	disableMailKind,
	signUnsubscribeToken as signToken,
	verifyUnsubscribeToken as verifyToken,
} from '@/core/mail/unsubscribe';

/** `<memberId>.<hmac>`: lets a statement recipient opt out without logging in. */
export function signUnsubscribeToken(memberId: string, secret?: string): string {
	return signToken(memberId, 'statement', secret);
}

/** The member id of a valid statement token; `null` for anything tampered, malformed or unverifiable. */
export function verifyUnsubscribeToken(
	token: string,
	secrets?: string | null | readonly string[],
): string | null {
	const parsed: UnsubscribeToken | null = verifyToken(token, secrets);
	return parsed?.kind === 'statement' ? parsed.memberId : null;
}

export function unsubscribeUrl(memberId: string): string {
	return url(memberId, 'statement');
}

/** Turns the statement mail off for every membership of the account. Idempotent. */
export function disableStatementEmail(memberId: string): Promise<void> {
	return disableMailKind(memberId, 'statement');
}
