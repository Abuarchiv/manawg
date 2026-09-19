import { expect, test } from '@playwright/test';
import { isTransientWebPushStatus } from '../src/core/notifications/web-push-errors';
import {
	pushAuthKeySchema,
	pushEndpointSchema,
	pushP256dhSchema,
} from '../src/core/validators/push-endpoint';

test('push subscription fields reject malformed and oversized values', () => {
	expect(pushEndpointSchema.safeParse('https://fcm.googleapis.com/fcm/send/token').success).toBe(
		true,
	);
	expect(pushP256dhSchema.safeParse('A'.repeat(87)).success).toBe(true);
	expect(pushAuthKeySchema.safeParse('A'.repeat(22)).success).toBe(true);
	expect(pushP256dhSchema.safeParse('A'.repeat(86)).success).toBe(false);
	expect(pushAuthKeySchema.safeParse('A'.repeat(23)).success).toBe(false);
	expect(pushAuthKeySchema.safeParse('!'.repeat(22)).success).toBe(false);
	expect(isTransientWebPushStatus(429)).toBe(true);
	expect(isTransientWebPushStatus(503)).toBe(true);
	expect(isTransientWebPushStatus(400)).toBe(false);
});
