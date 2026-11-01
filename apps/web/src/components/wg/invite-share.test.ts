import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { shareInvite } from './invite-share';

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
