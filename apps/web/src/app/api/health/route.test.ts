import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = { execute: vi.fn() };

vi.mock('@/core/db', () => ({ db: dbMock }));

import { GET } from './route';

const request = () => new NextRequest('https://manawg.test/api/health');

describe('health route', () => {
	beforeEach(() => {
		dbMock.execute.mockReset().mockResolvedValue([{ '?column?': 1 }]);
		vi.stubEnv('POSTGRES_URL', 'postgres://localhost/manawg');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('reports ok when the database answers and nothing required is missing', async () => {
		const response = await GET(request());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.status).toBe('ok');
		expect(body.database).toBe('ok');
	});

	it('reports 503 when the database is unreachable', async () => {
		dbMock.execute.mockRejectedValue(new Error('ECONNREFUSED'));

		const response = await GET(request());
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body.database).toBe('unreachable');
	});

	it('never leaks the database error text to an unauthenticated caller', async () => {
		dbMock.execute.mockRejectedValue(new Error('password authentication failed for user "admin"'));

		const response = await GET(request());
		const body = await response.text();

		expect(body).not.toContain('password');
		expect(body).not.toContain('admin');
	});

	it('lists switched-off features by name so a lost config is visible', async () => {
		const response = await GET(request());
		const body = await response.json();

		expect(body.degradedFeatures).toContain('rate-limiting');
	});

	it('reports 503 when a required variable is missing', async () => {
		vi.stubEnv('POSTGRES_URL', '');
		vi.stubEnv('DATABASE_URL', '');

		const response = await GET(request());
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body.missingRequiredCount).toBeGreaterThan(0);
	});

	it('does not disclose the values of missing variables', async () => {
		vi.stubEnv('POSTGRES_URL', '');
		vi.stubEnv('DATABASE_URL', '');
		vi.stubEnv('CRON_SECRET', 'super-secret-value');

		const response = await GET(request());
		const body = await response.text();

		expect(body).not.toContain('super-secret-value');
	});
});
