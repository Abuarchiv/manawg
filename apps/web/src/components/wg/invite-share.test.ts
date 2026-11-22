import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { inviteShareMessage, shareInvite } from './invite-share';

const url = 'https://x.test/invite/abc';
const text = `Join our WG on ManaWG: ${url}\n(valid for 7 days)`;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
	if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
	else Reflect.deleteProperty(globalThis, 'navigator');
});

test('the native share sheet receives the invite link exactly once', async () => {
	const share = mock.fn(async (_data: ShareData) => {});
	Object.defineProperty(globalThis, 'navigator', {
		value: { share, canShare: () => true },
		configurable: true,
	});
	assert.equal(await shareInvite(text), 'shared');
	assert.equal(share.mock.callCount(), 1);
	const data = share.mock.calls[0]?.arguments[0] as ShareData;
	const sent = [data.title, data.text, data.url].filter(Boolean).join(' ');
	assert.equal(sent.split(url).length - 1, 1);
});

test('the share text promises only the days the link has left', () => {
	const now = new Date('2026-11-22T12:00:00Z');
	const days = (expiresAt: string) =>
		inviteShareMessage('Altbau', url, expiresAt, now).values?.days;
	assert.equal(days('2026-12-06T12:00:00Z'), 14, 'a fresh link');
	assert.equal(days('2026-11-23T11:00:00Z'), 1, 'a link that expires tomorrow');
	assert.equal(days('2026-11-25T13:00:00Z'), 4, 'a part day counts as a day');
});
