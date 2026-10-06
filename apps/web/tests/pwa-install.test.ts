import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isIosLikeDevice } from '../src/shared/lib/pwa-install';

describe('pwa platform', () => {
	test('iPadOS desktop Safari is treated as an iOS-like device', () => {
		assert.equal(
			isIosLikeDevice({
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
				platform: 'MacIntel',
				maxTouchPoints: 5,
			}),
			true,
		);
		assert.equal(
			isIosLikeDevice({
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
				platform: 'MacIntel',
				maxTouchPoints: 0,
			}),
			false,
		);
	});
});
