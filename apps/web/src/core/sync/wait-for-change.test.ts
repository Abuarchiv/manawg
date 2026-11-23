import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForChange } from './wait-for-change';

const v = (members: string, data = '1') => ({ data, members, chat: '1' });

test('answers as soon as a watched version moves', async () => {
	const reads = [v('1'), v('1'), v('2')];
	let calls = 0;
	const read = async () => reads[Math.min(calls++, reads.length - 1)] ?? v('2');
	const got = await waitForChange(
		read,
		{ members: '1', data: '1' },
		{ timeoutMs: 5000, stepMs: 1 },
	);
	assert.equal(got.members, '2');
	assert.equal(calls, 3);
});

test('a chat-only move keeps waiting; the timeout answers with the latest versions', async () => {
	let calls = 0;
	const read = async () => {
		calls++;
		return { data: '1', members: '1', chat: String(calls) };
	};
	const got = await waitForChange(read, { members: '1', data: '1' }, { timeoutMs: 30, stepMs: 5 });
	assert.equal(got.members, '1');
	assert.ok(calls >= 2);
});

test('a revoke elsewhere (data) ends the wait too', async () => {
	let calls = 0;
	const read = async () => (calls++ ? v('1', '2') : v('1'));
	const started = Date.now();
	const got = await waitForChange(
		read,
		{ members: '1', data: '1' },
		{ timeoutMs: 5000, stepMs: 1 },
	);
	assert.equal(got.data, '2');
	// Answered on the read that saw the move, not at the timeout.
	assert.equal(calls, 2);
	assert.ok(Date.now() - started < 1000);
});

test('an aborted request stops reading', async () => {
	const controller = new AbortController();
	let calls = 0;
	const read = async () => {
		if (++calls === 2) controller.abort();
		return v('1');
	};
	await waitForChange(
		read,
		{ members: '1', data: '1' },
		{
			timeoutMs: 5000,
			stepMs: 1,
			signal: controller.signal,
		},
	);
	assert.equal(calls, 2);
});
