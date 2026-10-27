import assert from 'node:assert/strict';
import test from 'node:test';
import { withEnv } from '../../../tests/support/env';
import { acceptedSigningSecrets, currentSigningSecret } from './signing-secrets';

function withSecrets(current: string | undefined, previous: string | undefined, run: () => void) {
	withEnv({ MEMBER_SESSION_SECRET: current, MEMBER_SESSION_SECRET_PREVIOUS: previous }, run);
}

test('previous secrets stay accepted behind the current one', () => {
	withSecrets(' new ', 'old, older ,', () => {
		assert.equal(currentSigningSecret(), 'new');
		assert.deepEqual(acceptedSigningSecrets(), ['new', 'old', 'older']);
	});
});

test('without a current secret nothing is accepted, even if a previous list is set', () => {
	withSecrets(undefined, 'old', () => {
		assert.equal(currentSigningSecret(), null);
		assert.deepEqual(acceptedSigningSecrets(), []);
	});
	withSecrets(' ', 'old', () => {
		assert.deepEqual(acceptedSigningSecrets(), []);
	});
});
