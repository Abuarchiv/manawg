import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deferred } from './support/deferred.ts';
import { withEnv } from './support/env.ts';

test('deferred settles from outside and signals without a value', async () => {
	const gate = deferred<number>();
	gate.resolve(3);
	assert.equal(await gate.promise, 3);

	const signal = deferred();
	signal.resolve();
	assert.equal(await signal.promise, undefined);

	const failing = deferred();
	failing.reject(new Error('boom'));
	await assert.rejects(failing.promise, /boom/);
});

test('withEnv sets and removes variables and restores them for sync and async callbacks', async () => {
	process.env.TH_KEEP = 'before';
	Reflect.deleteProperty(process.env, 'TH_NEW');

	withEnv({ TH_KEEP: undefined, TH_NEW: 'x' }, () => {
		assert.equal(process.env.TH_KEEP, undefined);
		assert.equal(process.env.TH_NEW, 'x');
	});
	assert.equal(process.env.TH_KEEP, 'before');
	assert.equal(process.env.TH_NEW, undefined);

	await assert.rejects(
		withEnv({ TH_KEEP: 'during' }, async () => {
			assert.equal(process.env.TH_KEEP, 'during');
			throw new Error('fail');
		}),
		/fail/,
	);
	assert.equal(process.env.TH_KEEP, 'before');

	assert.throws(
		() =>
			withEnv({ TH_KEEP: 'during' }, () => {
				throw new Error('sync fail');
			}),
		/sync fail/,
	);
	assert.equal(process.env.TH_KEEP, 'before');
	Reflect.deleteProperty(process.env, 'TH_KEEP');
});
