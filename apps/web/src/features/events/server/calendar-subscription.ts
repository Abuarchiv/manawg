import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_SEED_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function sessionSecret(): string | null {
	const secret = process.env.MEMBER_SESSION_SECRET;
	return secret && secret.trim().length > 0 ? secret.trim() : null;
}

export function createCalendarFeedSeed(): string {
	return randomBytes(TOKEN_SEED_BYTES).toString('base64url');
}

export function deriveCalendarFeedToken(subscriptionId: string, tokenSeed: string): string | null {
	const secret = sessionSecret();
	if (!secret) return null;
	return createHmac('sha256', secret)
		.update(`calendar-feed:${subscriptionId}:${tokenSeed}`)
		.digest('base64url');
}

export function isCalendarFeedToken(value: unknown): value is string {
	return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function verifyCalendarFeedToken(
	subscriptionId: string,
	tokenSeed: string,
	token: string,
): boolean {
	if (!isCalendarFeedToken(token)) return false;
	const expected = deriveCalendarFeedToken(subscriptionId, tokenSeed);
	if (!expected) return false;
	const expectedBytes = Buffer.from(expected, 'ascii');
	const providedBytes = Buffer.from(token, 'ascii');
	if (expectedBytes.length !== providedBytes.length) return false;
	return timingSafeEqual(expectedBytes, providedBytes);
}

export function calendarFeedUrl(baseUrl: string, subscriptionId: string, token: string): string {
	return `${baseUrl.replace(/\/$/, '')}/api/calendar/${encodeURIComponent(subscriptionId)}/${encodeURIComponent(token)}`;
}
