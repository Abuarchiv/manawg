import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api-client';

describe('apiFetch', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('uses API error codes when the error body has no message field', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			json: async () => ({ code: 'member_id_invalid' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await apiFetch('/api/wg/MTE8PZAT/members', { memberId: 'bad-local-id' });

		expect(result).toEqual({ ok: false, status: 401, error: 'member_id_invalid' });
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/wg/MTE8PZAT/members',
			expect.objectContaining({
				cache: 'no-store',
				headers: expect.any(Headers),
			}),
		);
	});

	it('keeps status text when an error response is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 502,
				statusText: 'Bad Gateway',
				json: async () => {
					throw new Error('not json');
				},
			}),
		);

		await expect(apiFetch('/api/wg/MTE8PZAT/members')).resolves.toEqual({
			ok: false,
			status: 502,
			error: 'Bad Gateway',
		});
	});
});
