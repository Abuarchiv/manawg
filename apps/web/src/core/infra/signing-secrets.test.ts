import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptedSigningSecrets, currentSigningSecret } from './signing-secrets';

function withSecrets(current: string | undefined, previous: string | undefined, run: () => void) {
	const before = [process.env.MEMBER_SESSION_SECRET, process.env.MEMBER_SESSION_SECRET_PREVIOUS];
	const set = (name: string, value: string | undefined) => {
		if (value === undefined) Reflect.deleteProperty(process.env, name);
		else process.env[name] = value;
	};
	set('MEMBER_SESSION_SECRET', current);
	set('MEMBER_SESSION_SECRET_PREVIOUS', previous);
	try {
		run();
	} finally {
		set('MEMBER_SESSION_SECRET', before[0]);
		set('MEMBER_SESSION_SECRET_PREVIOUS', before[1]);
	}
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
