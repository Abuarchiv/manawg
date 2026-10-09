import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { acceptedSigningSecrets, currentSigningSecret } from '@/core/infra/signing-secrets';

const TOKEN_SEED_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createCalendarFeedSeed(): string {
	return randomBytes(TOKEN_SEED_BYTES).toString('base64url');
}

function feedTokenFor(secret: string, subscriptionId: string, tokenSeed: string): string {
	return createHmac('sha256', secret)
		.update(`calendar-feed:${subscriptionId}:${tokenSeed}`)
		.digest('base64url');
}

export function deriveCalendarFeedToken(subscriptionId: string, tokenSeed: string): string | null {
	const secret = currentSigningSecret();
	return secret ? feedTokenFor(secret, subscriptionId, tokenSeed) : null;
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
	const providedBytes = Buffer.from(token, 'ascii');
	// Every accepted secret is checked, so the time taken does not tell which one matched.
	let valid = false;
	for (const secret of acceptedSigningSecrets()) {
		const expectedBytes = Buffer.from(feedTokenFor(secret, subscriptionId, tokenSeed), 'ascii');
		if (
			expectedBytes.length === providedBytes.length &&
			timingSafeEqual(expectedBytes, providedBytes)
		) {
			valid = true;
		}
	}
	return valid;
}

export function calendarFeedUrl(baseUrl: string, subscriptionId: string, token: string): string {
	return `${baseUrl.replace(/\/$/, '')}/api/calendar/${encodeURIComponent(subscriptionId)}/${encodeURIComponent(token)}`;
}
