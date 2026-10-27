import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { E2E_CREATED_WG, E2E_EXISTING_WG, FIXTURE_AUTH_USER_ID } from '@/fixtures/data';
import { resolveFixtureRequest } from '@/fixtures/middleware';
import { isE2EDbDownMode } from '@/fixtures/mode';
import { loadFixtureWgView } from '@/fixtures/pages';
import { NextRequest } from 'next/server.js';
import { withEnv } from './support/env.ts';

// `next` has no package exports map, so Node's ESM resolver needs the file
// name for the `next/server` import inside the lazily loaded fixture API.
registerHooks({
	resolve(specifier, context, nextResolve) {
		return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
	},
});

const FIXTURE_ENV: Record<string, string | undefined> = {
	E2E_FIXTURE_MODE: 'true',
	NEXT_PUBLIC_DB_DOWN: 'true',
	CI: 'true',
	VERCEL_ENV: 'preview',
	POSTGRES_URL: undefined,
	DATABASE_URL: undefined,
	VERCEL: undefined,
};

test('fixture mode activates for the local/CI fixture run', () => {
	assert.equal(
		withEnv(FIXTURE_ENV, () => isE2EDbDownMode()),
		true,
	);
});

test('fixture mode never activates on a hosted Vercel deployment', () => {
	assert.equal(
		withEnv({ ...FIXTURE_ENV, VERCEL: '1' }, () => isE2EDbDownMode()),
		false,
	);
});

test('fixture mode needs every condition', () => {
	for (const override of [
		{ VERCEL_ENV: 'production' },
		{ NEXT_PUBLIC_DB_DOWN: undefined },
		{ CI: undefined },
		{ E2E_FIXTURE_MODE: undefined },
		{ POSTGRES_URL: 'postgres://db.invalid:5432/app' },
		{ DATABASE_URL: 'postgres://db.invalid:5432/app' },
	]) {
		assert.equal(
			withEnv({ ...FIXTURE_ENV, NODE_ENV: 'production', ...override }, () => isE2EDbDownMode()),
			false,
			JSON.stringify(override),
		);
	}
});

test('the seams are inert outside fixture mode', () => {
	const off = { ...FIXTURE_ENV, VERCEL: '1' };
	const req = new NextRequest(`http://localhost/api/wg/${E2E_EXISTING_WG.shareCode}/members`);
	assert.equal(
		withEnv(off, () => resolveFixtureRequest(req)),
		null,
	);
	assert.equal(
		withEnv(off, () => loadFixtureWgView(E2E_EXISTING_WG.shareCode)),
		null,
	);
});

test('the page seam serves fixture WGs and rejects unknown codes', () => {
	const view = withEnv(FIXTURE_ENV, () => loadFixtureWgView(E2E_EXISTING_WG.shareCode));
	assert.ok(view && view !== 'not_found');
	assert.equal(view.wg.id, E2E_EXISTING_WG.id);
	assert.ok(view.members.every((member) => member.active));
	assert.equal(view.chatMessages()[0]?.wgId, E2E_EXISTING_WG.id);
	assert.equal(
		withEnv(FIXTURE_ENV, () => loadFixtureWgView('ZZZZZZZZ')),
		'not_found',
	);
});

async function fixtureApi(
	path: string,
	init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
	return withEnv(FIXTURE_ENV, async () => {
		const fixture = resolveFixtureRequest(new NextRequest(`http://localhost${path}`, init));
		assert.ok(fixture);
		return fixture.apiResponse();
	});
}

test('fixture API reads still enforce fixture membership', async () => {
	const path = `/api/wg/${E2E_EXISTING_WG.shareCode}/members`;
	const noHeader = await fixtureApi(path);
	assert.equal(noHeader?.status, 401);
	assert.deepEqual(await noHeader?.json(), { error: 'auth_required', code: 'auth_required' });

	const stranger = await fixtureApi(path, {
		headers: { 'x-manawg-expected-member-id': '00000000-0000-4000-8000-000000000000' },
	});
	assert.equal(stranger?.status, 401);
	assert.deepEqual(await stranger?.json(), { error: 'not_a_member', code: 'not_a_member' });

	const member = await fixtureApi(path, {
		headers: { 'x-manawg-expected-member-id': E2E_EXISTING_WG.member.id },
	});
	assert.equal(member?.status, 200);
	const body = (await member?.json()) as { members: Array<{ id: string }> };
	assert.ok(body.members.some(({ id }) => id === E2E_EXISTING_WG.member.id));

	const unknownWg = await fixtureApi('/api/wg/ZZZZZZZZ/members');
	assert.equal(unknownWg?.status, 404);
});

test('fixture API leaves validation and writes to the real route', async () => {
	assert.equal(await fixtureApi('/api/wg/not-a-code/members'), null);
	assert.equal(await fixtureApi(`/api/wg/${E2E_EXISTING_WG.shareCode}/export?format=xml`), null);
	assert.equal(
		await fixtureApi(`/api/wg/${E2E_EXISTING_WG.shareCode}/shopping`, { method: 'POST' }),
		null,
	);
	assert.equal(await fixtureApi('/api/wg/mine', { method: 'POST' }), null);

	const bootstrap = await fixtureApi(`/api/wg/${E2E_EXISTING_WG.shareCode}`);
	assert.equal(bootstrap?.status, 200);
	const { currentMember } = (await bootstrap?.json()) as {
		currentMember: { memberId: string; authUserId: string };
	};
	assert.equal(currentMember.memberId, E2E_EXISTING_WG.member.id);
	assert.equal(currentMember.authUserId, FIXTURE_AUTH_USER_ID);
});

test('fixture API lists the fixture WGs for the account with their member ids', async () => {
	assert.equal(await fixtureApi('/api/wg/mine'), null, 'guests reach the real route');
	const res = await fixtureApi('/api/wg/mine', { headers: { cookie: 'manawg_signed_in=1' } });
	assert.equal(res?.status, 200);
	const { wgs } = (await res?.json()) as { wgs: Array<{ code: string; memberId: string }> };
	assert.deepEqual(
		wgs.map(({ code, memberId }) => ({ code, memberId })),
		[
			{ code: E2E_EXISTING_WG.shareCode, memberId: E2E_EXISTING_WG.member.id },
			{ code: E2E_CREATED_WG.shareCode, memberId: E2E_CREATED_WG.member.id },
		],
	);
});

test('fixture WG create answers valid bodies and leaves the rest to the route', async () => {
	const create = (body: unknown) =>
		fixtureApi('/api/wg', { method: 'POST', body: JSON.stringify(body) });

	const created = await create({ name: ' Neue WG ', creatorName: 'Alex' });
	assert.equal(created?.status, 200);
	assert.deepEqual(await created?.json(), {
		wg: { id: E2E_CREATED_WG.id, shareCode: E2E_CREATED_WG.shareCode, name: 'Neue WG' },
		creator: { id: E2E_CREATED_WG.member.id, name: 'Alex' },
	});

	assert.equal(await create({ name: '   ', creatorName: 'Alex' }), null);
	assert.equal(await create({ name: 'WG', creatorName: 'x'.repeat(81) }), null);
	assert.equal(await create(['not', 'an', 'object']), null);
	assert.equal(await fixtureApi('/api/wg', { method: 'POST', body: '{' }), null);
});
