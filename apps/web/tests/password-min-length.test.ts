import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const min = Number(
	read('../src/components/auth/auth-form-shared.tsx').match(
		/NEW_PASSWORD_MIN_LENGTH = (\d+);/,
	)?.[1],
);

test('self-hosted GoTrue enforces the new-password minimum the forms show', () => {
	assert.ok(min >= 8);
	assert.match(
		read('../../../compose.yaml'),
		new RegExp(`^\\s+GOTRUE_PASSWORD_MIN_LENGTH: ${min}$`, 'm'),
	);
	assert.match(
		read('../scripts/real-stack/supabase-config.toml'),
		new RegExp(`^minimum_password_length = ${min}$`, 'm'),
	);
});
