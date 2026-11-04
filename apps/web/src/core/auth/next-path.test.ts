import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { safeNextPath, wgReturnPath, withHash } from './next-path';

test('keeps same-origin paths with query and hash', () => {
	assert.equal(safeNextPath('/wg/MTE8PZAT/shopping?x=1#a'), '/wg/MTE8PZAT/shopping?x=1#a');
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
			new URL(next, 'https://app.manawg.com/login').origin,
			'https://app.manawg.com',
			String(value),
		);
	}
});

test('a sign-in redirect keeps the requested page of the same WG', () => {
	assert.equal(
		wgReturnPath('ABCD2345', '/wg/ABCD2345/expenses?highlight=7'),
		'/wg/ABCD2345/expenses?highlight=7',
	);
	assert.equal(wgReturnPath('ABCD2345', '/wg/ABCD2345'), '/wg/ABCD2345');
});

test('a lowercase or look-alike spelling of the same code keeps its page', () => {
	assert.equal(wgReturnPath('ABCD2345', '/wg/abcd2345/expenses?x=1'), '/wg/ABCD2345/expenses?x=1');
	assert.equal(wgReturnPath('AB1D2345', '/wg/abid2345'), '/wg/AB1D2345');
});

test('a missing, foreign or unsafe request path falls back to the WG start', () => {
	assert.equal(wgReturnPath('ABCD2345', null), '/wg/ABCD2345');
	assert.equal(wgReturnPath('ABCD2345', '/wg/OTHER234/expenses'), '/wg/ABCD2345');
	assert.equal(wgReturnPath('ABCD2345', '/wg/ABCD2345evil'), '/wg/ABCD2345');
	assert.equal(wgReturnPath('ABCD2345', '//evil.example/wg/ABCD2345'), '/wg/ABCD2345');
});

// Property-based: random strings built mostly from slashes, dots and a host-like segment, the
// pieces whose combinations ("/.//x", "/\\x", "/%2e%2e//x") change where a URL resolves.
const urlish = fc
	.array(
		fc.oneof(
			{ arbitrary: fc.constantFrom('/', '.', 'x'), weight: 6 },
			{ arbitrary: fc.constantFrom('\\', '..', ':', '?', '#', '%2e', '%2f', '@', '\t'), weight: 2 },
			{ arbitrary: fc.string({ minLength: 1, maxLength: 1, unit: 'binary' }), weight: 1 },
		),
		{ maxLength: 12 },
	)
	.map((parts) => parts.join(''));

test('no input leaves the origin', () => {
	fc.assert(
		fc.property(fc.oneof(urlish, fc.webUrl(), fc.string({ unit: 'binary' })), (value) => {
			const path = safeNextPath(value);
			assert.ok(path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'), path);
			assert.equal(new URL(path, 'https://app.example').origin, 'https://app.example');
			assert.equal(safeNextPath(path), path);
		}),
		{ numRuns: 2000 },
	);
});

test('withHash appends the entry fragment to a WG path', () => {
	assert.equal(withHash('/wg/ABC/chat', '#message-1'), '/wg/ABC/chat#message-1');
	assert.equal(withHash('/wg/ABC/chat?x=1', '#notifications'), '/wg/ABC/chat?x=1#notifications');
	assert.equal(
		safeNextPath(withHash('/wg/ABC/pinboard', '#announcement-9')),
		'/wg/ABC/pinboard#announcement-9',
	);
});

test('withHash leaves other targets and unusable fragments alone', () => {
	assert.equal(withHash('/wg/ABC/chat#x', '#y'), '/wg/ABC/chat#x');
	assert.equal(withHash('/', '#a'), '/');
	assert.equal(withHash('/login', '#a'), '/login');
	assert.equal(withHash('/wg/ABC/chat', '#<script>'), '/wg/ABC/chat');
	assert.equal(withHash('/wg/ABC/chat', '#'), '/wg/ABC/chat');
	assert.equal(withHash('/wg/ABC/chat', ''), '/wg/ABC/chat');
	assert.equal(withHash('/wg/ABC/chat', `#${'a'.repeat(201)}`), '/wg/ABC/chat');
});
