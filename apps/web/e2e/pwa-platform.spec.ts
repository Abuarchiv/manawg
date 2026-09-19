import { expect, test } from '@playwright/test';
import { isIosLikeDevice } from '../src/shared/lib/pwa-install';

test('iPadOS desktop Safari is treated as an iOS-like device', () => {
	expect(
		isIosLikeDevice({
			userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
			platform: 'MacIntel',
			maxTouchPoints: 5,
		}),
	).toBe(true);
	expect(
		isIosLikeDevice({
			userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
			platform: 'MacIntel',
			maxTouchPoints: 0,
		}),
	).toBe(false);
});
