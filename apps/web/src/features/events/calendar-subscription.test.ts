import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	calendarFeedUrl,
	createCalendarFeedSeed,
	deriveCalendarFeedToken,
	isCalendarFeedToken,
	verifyCalendarFeedToken,
} from './calendar-subscription';

const SUBSCRIPTION_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => vi.unstubAllEnvs());

describe('calendar feed capability', () => {
	it('uses a random seed and a secret-bound token that rotates safely', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
		const seed = createCalendarFeedSeed();
		const token = deriveCalendarFeedToken(SUBSCRIPTION_ID, seed);
		const otherToken = deriveCalendarFeedToken(SUBSCRIPTION_ID, createCalendarFeedSeed());

		expect(seed).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(token).not.toBe(otherToken);
		expect(verifyCalendarFeedToken(SUBSCRIPTION_ID, seed, token ?? '')).toBe(true);
		expect(verifyCalendarFeedToken(SUBSCRIPTION_ID, seed, otherToken ?? '')).toBe(false);
		expect(isCalendarFeedToken('not-a-feed-token')).toBe(false);
	});

	it('fails closed when the server secret is unavailable', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', '');
		const seed = createCalendarFeedSeed();
		expect(deriveCalendarFeedToken(SUBSCRIPTION_ID, seed)).toBeNull();
		expect(verifyCalendarFeedToken(SUBSCRIPTION_ID, seed, 'a'.repeat(43))).toBe(false);
	});

	it('builds a same-origin feed URL without exposing other credentials', () => {
		const url = calendarFeedUrl('https://mana.example/', SUBSCRIPTION_ID, 'a'.repeat(43));
		expect(url).toBe(`https://mana.example/api/calendar/${SUBSCRIPTION_ID}/${'a'.repeat(43)}`);
	});
});
