import { describe, expect, it } from 'vitest';
import {
	createPendingImageToken,
	isPendingImageToken,
	pendingImageIdFromToken,
} from './offline-images';

describe('offline image token helpers', () => {
	it('creates and recognises pending image tokens', () => {
		const token = createPendingImageToken('abc');

		expect(token).toBe('manawg-pending-image:abc');
		expect(isPendingImageToken(token)).toBe(true);
		expect(isPendingImageToken('https://example.test/image.jpg')).toBe(false);
		expect(pendingImageIdFromToken(token)).toBe('abc');
	});
});
