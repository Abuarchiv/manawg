import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const s3Mock = vi.hoisted(() => ({
	createPresignedUpload: vi.fn(),
	isAllowedMimeType: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	uploadSignLimiter: { name: 'uploadSignLimiter' },
}));

vi.mock('@/lib/s3', () => ({
	S3_MAX_UPLOAD_BYTES: 8 * 1024 * 1024,
	createPresignedUpload: (...args: unknown[]) => s3Mock.createPresignedUpload(...args),
	isAllowedMimeType: (...args: unknown[]) => s3Mock.isAllowedMimeType(...args),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		uploadSignLimiter: rateLimitMock.uploadSignLimiter,
	};
});

describe('upload sign route', () => {
	beforeEach(() => {
		resetRouteHarness();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
	});

	it('returns invalid_mime_type for malformed mimeType before auth, db, or S3 work', async () => {
		const { POST } = await import('./route');
		const cases: Array<Record<string, unknown>> = [
			{ shareCode: 'MTE8PZAT', purpose: 'expense', fileSize: 1024 },
			{ shareCode: 'MTE8PZAT', purpose: 'expense', mimeType: 42, fileSize: 1024 },
		];

		for (const body of cases) {
			const res = await POST(
				new NextRequest('https://mana.test/api/upload/sign', {
					method: 'POST',
					body: JSON.stringify(body),
				}),
			);

			expect(res.status).toBe(400);
			await expect(res.json()).resolves.toEqual({ error: 'invalid_mime_type' });
		}

		expect(routeDb.query.wgs.findFirst).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
		expect(s3Mock.isAllowedMimeType).not.toHaveBeenCalled();
		expect(s3Mock.createPresignedUpload).not.toHaveBeenCalled();
	});

	it('RED BUG-555: rate-limits upload signing before issuing presigned upload capabilities', async () => {
		const { POST } = await import('./route');
		routeDb.query.wgs.findFirst.mockResolvedValue({ id: 'wg-1' });
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: 'member-1' },
		});
		s3Mock.isAllowedMimeType.mockReturnValue(true);
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: 0,
		});

		const res = await POST(
			new NextRequest('https://mana.test/api/upload/sign', {
				method: 'POST',
				body: JSON.stringify({
					shareCode: 'MTE8PZAT',
					purpose: 'expense',
					mimeType: 'image/png',
					fileSize: 1024,
				}),
			}),
		);

		expect(res.status).toBe(429);
		await expect(res.json()).resolves.toMatchObject({
			error: 'upload_sign_rate_limited',
			code: 'upload_sign_rate_limited',
		});
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.uploadSignLimiter,
			'wg-1:member-1',
		);
		expect(s3Mock.createPresignedUpload).not.toHaveBeenCalled();
	});
});
