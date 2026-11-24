import assert from 'node:assert/strict';
import test from 'node:test';
import { loopbackClient } from '../scripts/test-db-setup.mjs';

// The setup script and the upgrade rehearsal create, drop and migrate databases: they must refuse
// any URL whose effective node-postgres target is not loopback, including query overrides.

test('accepts loopback targets', () => {
	for (const url of [
		'postgresql://postgres@127.0.0.1:55432/manawg_test',
		'postgresql://postgres@localhost/postgres',
		'postgresql://postgres@[::1]:5432/postgres',
	]) {
		assert.doesNotThrow(() => loopbackClient(url), url);
	}
});

test('rejects URLs whose effective host is not loopback', () => {
	for (const url of [
		'postgresql://postgres@db.example.test/postgres',
		'postgresql://postgres@localhost/postgres?host=db.example.test',
		'postgresql://postgres@127.0.0.1/postgres?host=%2Fvar%2Frun%2Fpostgresql',
		'postgresql://postgres@localhost,db.example.test/postgres',
	]) {
		assert.throws(() => loopbackClient(url), /must be on a loopback host/, url);
	}
});

test('rejects a PGHOST fallback to a remote server', () => {
	const previous = process.env.PGHOST;
	process.env.PGHOST = 'db.example.test';
	try {
		assert.throws(() => loopbackClient('postgresql:///postgres'), /must be on a loopback host/);
	} finally {
		if (previous === undefined) delete process.env.PGHOST;
		else process.env.PGHOST = previous;
	}
});
