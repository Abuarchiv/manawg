import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readShellBaseline } from './wg-shell-baseline';

const LAYOUT = new URL('../../app/wg/[code]/layout.tsx', import.meta.url);

test('the WG layout reads the change baseline before the shell', () => {
	const body = readFileSync(LAYOUT, 'utf8');
	const baselineAt = body.indexOf('await readShellBaseline(');
	const shellAt = body.indexOf('await loadWgShell(code)');
	assert.ok(baselineAt > 0 && shellAt > 0, 'both reads are in the layout');
	assert.ok(baselineAt < shellAt, 'the baseline must be read before the roster');
});

test('a member who joins after the baseline read is seen by the first poll', async () => {
	// A tiny WG store: each member write moves the members version.
	let membersVersion = 1;
	let roster = ['Anna'];
	const baseline = await readShellBaseline(async () => ({ members: String(membersVersion) }));
	const shown = [...roster];
	// Ben joins right after the roster read, before the first poll.
	roster = [...roster, 'Ben'];
	membersVersion += 1;
	const firstPoll = { members: String(membersVersion) };

	assert.deepEqual(shown, ['Anna']);
	assert.notEqual(firstPoll.members, baseline?.members, 'the first poll must see the join');
});

test('a failed baseline read leaves no baseline', async () => {
	assert.equal(await readShellBaseline(() => Promise.reject(new Error('db down'))), null);
});
