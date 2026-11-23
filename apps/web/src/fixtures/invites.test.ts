import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';

const {
	E2E_CREATED_WG,
	E2E_EXISTING_WG,
	E2E_EXPIRED_INVITE_TOKEN,
	E2E_INVITE_TOKEN,
	getE2EWgFixture,
} = await import('./data');
const { currentInvite, inviteLookup, invitePreview } = await import('./invites');

const request = (code: string) =>
	new NextRequest(`https://app.example.test/api/wg/${code}/invites/current`, { method: 'POST' });

test('currentInvite gives a solo fixture WG the fresh, joinable link', async () => {
	const fixture = getE2EWgFixture(E2E_CREATED_WG.shareCode);
	assert.ok(fixture);
	const body = await currentInvite(request(fixture.shareCode), fixture).json();
	assert.equal(body.invite.url, `https://app.example.test/invite/${E2E_INVITE_TOKEN}`);
	assert.ok(Date.parse(body.invite.expiresAt) > Date.now());
});

test('currentInvite gives a fixture WG with flatmates no link', async () => {
	const fixture = getE2EWgFixture(E2E_EXISTING_WG.shareCode);
	assert.ok(fixture);
	assert.deepEqual(await currentInvite(request(fixture.shareCode), fixture).json(), {
		invite: null,
	});
});

test('inviteLookup and invitePreview tell valid, expired and unknown tokens apart', async () => {
	assert.equal(inviteLookup(E2E_INVITE_TOKEN).status, 200);
	assert.equal(inviteLookup(E2E_EXPIRED_INVITE_TOKEN).status, 410);
	assert.equal(inviteLookup('unknown-token').status, 404);
	assert.equal((await invitePreview(E2E_INVITE_TOKEN).json()).wgName, E2E_EXISTING_WG.name);
	assert.equal(invitePreview(E2E_EXPIRED_INVITE_TOKEN).status, 404);
});
