import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wgReturnPath } from './next-path';

test('a sign-in redirect keeps the requested page of the same WG', () => {
	assert.equal(
		wgReturnPath('ABCD2345', '/wg/ABCD2345/ausgaben?highlight=7'),
		'/wg/ABCD2345/ausgaben?highlight=7',
	);
	assert.equal(wgReturnPath('ABCD2345', '/wg/ABCD2345'), '/wg/ABCD2345');
});

test('a missing, foreign or unsafe request path falls back to the WG start', () => {
	assert.equal(wgReturnPath('ABCD2345', null), '/wg/ABCD2345');
	assert.equal(wgReturnPath('ABCD2345', '/wg/OTHER234/ausgaben'), '/wg/ABCD2345');
	assert.equal(wgReturnPath('ABCD2345', '/wg/ABCD2345evil'), '/wg/ABCD2345');
	assert.equal(wgReturnPath('ABCD2345', '//evil.example/wg/ABCD2345'), '/wg/ABCD2345');
});
