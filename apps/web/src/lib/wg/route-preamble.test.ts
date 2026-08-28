import { E2E_EXISTING_WG } from '@/lib/e2e-db-down';
import { MEMBER_ID_HEADER } from '@manawg/shared/lib/member-header';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readShareCode, resolveE2EFixture } from './route-preamble';

const requestWithMember = (memberId?: string): NextRequest =>
	new NextRequest(
		'https://manawg.test/api/wg/ABCDEFGH/chores',
		memberId === undefined ? {} : { headers: { [MEMBER_ID_HEADER]: memberId } },
	);

const ctxWith = (code: string) => ({ params: Promise.resolve({ code }) });

describe('readShareCode', () => {
	it('normalizes the raw param so lowercase links keep working', async () => {
		const result = await readShareCode(ctxWith(E2E_EXISTING_WG.shareCode.toLowerCase()));

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.code).toBe(E2E_EXISTING_WG.shareCode);
	});

	it('rejects a malformed code with 400 invalid_share_code', async () => {
		const result = await readShareCode(ctxWith('nope'));

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.response.status).toBe(400);
			await expect(result.response.json()).resolves.toMatchObject({
				error: 'invalid_share_code',
			});
		}
	});
});

describe('resolveE2EFixture', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe('outside E2E db-down mode', () => {
		it('reports live so the route falls through to the real database', async () => {
			const result = await resolveE2EFixture(
				requestWithMember(E2E_EXISTING_WG.member.id),
				E2E_EXISTING_WG.shareCode,
			);

			expect(result.mode).toBe('live');
		});
	});

	describe('in E2E db-down mode', () => {
		beforeEach(() => {
			vi.stubEnv('NEXT_PUBLIC_DB_DOWN', 'true');
			vi.stubEnv('CI', 'true');
			vi.stubEnv('POSTGRES_URL', '');
			vi.stubEnv('DATABASE_URL', '');
		});

		it('returns the fixture for a known code and a member of it', async () => {
			const result = await resolveE2EFixture(
				requestWithMember(E2E_EXISTING_WG.member.id),
				E2E_EXISTING_WG.shareCode,
			);

			expect(result.mode).toBe('fixture');
			if (result.mode === 'fixture') expect(result.fixture.id).toBe(E2E_EXISTING_WG.id);
		});

		it('answers 404 wg_not_found for a code without a fixture', async () => {
			const result = await resolveE2EFixture(requestWithMember('irrelevant'), 'ZZZZZZZZ');

			expect(result.mode).toBe('denied');
			if (result.mode === 'denied') expect(result.response.status).toBe(404);
		});

		it('answers 401 when the caller sends no member id', async () => {
			const result = await resolveE2EFixture(requestWithMember(), E2E_EXISTING_WG.shareCode);

			expect(result.mode).toBe('denied');
			if (result.mode === 'denied') {
				expect(result.response.status).toBe(401);
				await expect(result.response.json()).resolves.toMatchObject({
					error: 'member_id_required',
				});
			}
		});

		it('answers 401 when the caller is not a member of the fixture WG', async () => {
			const result = await resolveE2EFixture(
				requestWithMember('11111111-1111-4111-8111-111111111111'),
				E2E_EXISTING_WG.shareCode,
			);

			expect(result.mode).toBe('denied');
			if (result.mode === 'denied') {
				expect(result.response.status).toBe(401);
				await expect(result.response.json()).resolves.toMatchObject({ error: 'not_a_member' });
			}
		});
	});
});
