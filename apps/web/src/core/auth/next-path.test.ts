import assert from 'node:assert/strict';
import test from 'node:test';
import { safeNextPath, wgReturnPath } from './next-path';

test('keeps same-origin paths with query and hash', () => {
	assert.equal(safeNextPath('/wg/MTE8PZAT/einkauf?x=1#a'), '/wg/MTE8PZAT/einkauf?x=1#a');
	assert.equal(safeNextPath('/a/../wg'), '/wg');
});

test('never returns a path that a browser resolves to another host', () => {
	for (const value of [
		null,
		'',
		'https://evil.com',
		'//evil.com',
		'/\\evil.com',
		'/.//evil.com',
		'/%2e//evil.com',
		'/a/..//evil.com',
		'/./%2F/evil.com',
	]) {
		const next = safeNextPath(value);
		assert.equal(
			new URL(next, 'https://app.manawg.com/neu').origin,
			'https://app.manawg.com',
			String(value),
		);
	}
});

test('a sign-in redirect keeps the requested page of the same WG', () => {
	assert.equal(
		wgReturnPath('ABCD2345', '/wg/ABCD2345/ausgaben?highlight=7'),
		'/wg/ABCD2345/ausgaben?highlight=7',
	);
	assert.equal(wgReturnPath('ABCD2345', '/wg/ABCD2345'), '/wg/ABCD2345');
});

test('a lowercase or look-alike spelling of the same code keeps its page', () => {
	assert.equal(wgReturnPath('ABCD2345', '/wg/abcd2345/ausgaben?x=1'), '/wg/ABCD2345/ausgaben?x=1');
	assert.equal(wgReturnPath('AB1D2345', '/wg/abid2345'), '/wg/AB1D2345');
});

test('a missing, foreign or unsafe request path falls back to the WG start', () => {
	assert.equal(wgReturnPath('ABCD2345', null), '/wg/ABCD2345');
	assert.equal(wgReturnPath('ABCD2345', '/wg/OTHER234/ausgaben'), '/wg/ABCD2345');
	assert.equal(wgReturnPath('ABCD2345', '/wg/ABCD2345evil'), '/wg/ABCD2345');
	assert.equal(wgReturnPath('ABCD2345', '//evil.example/wg/ABCD2345'), '/wg/ABCD2345');
});
