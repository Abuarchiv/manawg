import assert from 'node:assert/strict';
import test from 'node:test';
import { extractInviteToken, isInviteToken } from './invite-token';

const TOKEN = 'aB3_-xYz09aB3_-xYz09kQ';

test('accepts exactly 22 base64url characters', () => {
	assert.equal(isInviteToken(TOKEN), true);
	assert.equal(isInviteToken(`${TOKEN}x`), false);
	assert.equal(isInviteToken('MTE8PZAT'), false);
	assert.equal(isInviteToken(`${TOKEN.slice(0, 21)}+`), false);
});

test('finds the token in a link, a query or a bare paste', () => {
	assert.equal(extractInviteToken(`https://app.manawg.com/invite/${TOKEN}`), TOKEN);
	assert.equal(
		extractInviteToken(`Komm in die WG: https://x.test/invite/${TOKEN}\nBis bald`),
		TOKEN,
	);
	assert.equal(extractInviteToken(`https://x.test/login?invite=${TOKEN}`), TOKEN);
	assert.equal(extractInviteToken(`  ${TOKEN}  `), TOKEN);
});

test('rejects share codes and over-long tokens', () => {
	assert.equal(extractInviteToken('https://x.test/login?code=MTE8PZAT'), '');
	assert.equal(extractInviteToken('MTE8PZAT'), '');
	assert.equal(extractInviteToken(`https://x.test/invite/${TOKEN}extra`), '');
});
