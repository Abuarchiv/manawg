import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { fixtureClientProps, isClientFixtureMode } from '@/fixtures/client-mode';
import { E2E_EXISTING_WG } from '@/fixtures/data';
import { resolveFixtureRequest } from '@/fixtures/middleware';
import { isE2EDbDownMode } from '@/fixtures/mode';
import { loadFixtureWgView } from '@/fixtures/pages';
import { NextRequest } from 'next/server.js';

// `next` has no package exports map, so Node's ESM resolver needs the file
// name for the `next/server` import inside the lazily loaded fixture API.
registerHooks({
	resolve(specifier, context, nextResolve) {
		return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
	},
});

const FIXTURE_ENV: Record<string, string> = {
	E2E_FIXTURE_MODE: 'true',
	NEXT_PUBLIC_DB_DOWN: 'true',
	CI: 'true',
	VERCEL_ENV: 'preview',
	POSTGRES_URL: '',
	DATABASE_URL: '',
	VERCEL: '',
};

function withEnv<T>(overrides: Record<string, string>, fn: () => T): T {
	const previous: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(overrides)) {
		previous[key] = process.env[key];
		if (value === '') delete process.env[key];
		else process.env[key] = value;
	}
	const restore = () => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
	try {
		const result = fn();
		if (result instanceof Promise) return result.finally(restore) as T;
		restore();
		return result;
	} catch (err) {
		restore();
		throw err;
	}
}

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
		{ NEXT_PUBLIC_DB_DOWN: '' },
		{ CI: '' },
		{ E2E_FIXTURE_MODE: '' },
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

test('client fixture mode needs both public flags', () => {
	const both = { NEXT_PUBLIC_DB_DOWN: 'true', NEXT_PUBLIC_E2E_FIXTURE_MODE: 'true' };
	assert.equal(
		withEnv(both, () => isClientFixtureMode()),
		true,
	);
	assert.deepEqual(
		withEnv(both, () => fixtureClientProps()),
		{ sessionless: true },
	);
	assert.deepEqual(
		withEnv({ ...both, NEXT_PUBLIC_E2E_FIXTURE_MODE: '' }, () => fixtureClientProps()),
		{ sessionless: false },
	);
	assert.equal(
		withEnv({ ...both, NEXT_PUBLIC_DB_DOWN: '' }, () => isClientFixtureMode()),
		false,
	);
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
	init: { method?: string; headers?: Record<string, string> } = {},
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
		headers: { 'x-manawg-member-id': '00000000-0000-4000-8000-000000000000' },
	});
	assert.equal(stranger?.status, 401);
	assert.deepEqual(await stranger?.json(), { error: 'not_a_member', code: 'not_a_member' });

	const member = await fixtureApi(path, {
		headers: { 'x-manawg-member-id': E2E_EXISTING_WG.member.id },
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
	assert.equal(await fixtureApi('/api/wg/mine'), null);

	const bootstrap = await fixtureApi(`/api/wg/${E2E_EXISTING_WG.shareCode}`);
	assert.equal(bootstrap?.status, 200);
	assert.equal(
		((await bootstrap?.json()) as { currentMember: { memberId: string } }).currentMember.memberId,
		E2E_EXISTING_WG.member.id,
	);
});
