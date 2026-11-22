import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadShellWithBaseline } from './wg-shell-baseline.ts';

test('a member who joins between the shell and baseline reads is seen by the first poll', async () => {
	// A tiny WG store: each member write moves the members version.
	let membersVersion = 1;
	let roster = ['Anna'];
	const readBaseline = async () => ({ members: String(membersVersion) });
	const loadShell = async () => {
		const shown = [...roster];
		// Ben joins right after the roster read, before the layout's next read.
		roster = [...roster, 'Ben'];
		membersVersion += 1;
		return { members: shown };
	};

	const { baseline, shell } = await loadShellWithBaseline(readBaseline, loadShell);
	const firstPoll = { members: String(membersVersion) };

	assert.deepEqual(shell.members, ['Anna']);
	assert.notEqual(firstPoll.members, baseline?.members, 'the first poll must see the join');
});

test('a failed baseline read leaves no baseline and still loads the shell', async () => {
	const { baseline, shell } = await loadShellWithBaseline(
		() => Promise.reject(new Error('db down')),
		async () => 'shell',
	);
	assert.equal(baseline, null);
	assert.equal(shell, 'shell');
});
