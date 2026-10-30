/** An invitation token is 16 random bytes in base64url: 22 characters. */
const INVITE_TOKEN_REGEX = /^[A-Za-z0-9_-]{22}$/;
const INVITE_LINK_REGEX = /\/invite\/([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/;
const INVITE_QUERY_REGEX = /[?&]invite=([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/;

/** How long a new invitation link works, in days. */
export const INVITE_VALID_DAYS = 7;

export function isInviteToken(value: string): boolean {
	return INVITE_TOKEN_REGEX.test(value);
}

/** Pulls a token out of a pasted invitation link or a bare token; '' when none is found. */
export function extractInviteToken(text: string): string {
	const found = INVITE_LINK_REGEX.exec(text)?.[1] ?? INVITE_QUERY_REGEX.exec(text)?.[1];
	if (found) return found;
	const bare = text.trim();
	return isInviteToken(bare) ? bare : '';
}

export function invitePath(token: string): string {
	return `/invite/${encodeURIComponent(token)}`;
}
