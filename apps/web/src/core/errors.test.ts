import { afterEach, describe, expect, it, vi } from 'vitest';

const observabilityMock = vi.hoisted(() => ({
	captureException: vi.fn(),
}));

vi.mock('@/core/infra/observability', () => observabilityMock);

describe('serverError', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('BUG-271: reports string-coded server errors', async () => {
		const { serverError } = await import('./errors');

		const res = serverError('insert_failed');

		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: 'insert_failed' });
		expect(observabilityMock.captureException).toHaveBeenCalledWith(expect.any(Error));
		expect(observabilityMock.captureException.mock.calls[0]?.[0]).toMatchObject({
			message: 'insert_failed',
		});
	});

	it('reports a caught error and returns the generic message', async () => {
		const { serverError } = await import('./errors');
		const caught = new Error('db exploded');

		const res = serverError(caught);

		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: 'server_error' });
		expect(observabilityMock.captureException).toHaveBeenCalledWith(caught);
	});

	it('reports nothing when called without arguments', async () => {
		const { serverError } = await import('./errors');

		const res = serverError();

		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: 'server_error' });
		expect(observabilityMock.captureException).not.toHaveBeenCalled();
	});
});
