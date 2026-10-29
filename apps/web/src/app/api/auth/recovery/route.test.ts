import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { DELETE } from './route';

const clear = async (origin: string) =>
	(await DELETE(new NextRequest(`${origin}/api/auth/recovery`, { method: 'DELETE' }))).cookies.get(
		'manawg_password_recovery',
	) as unknown as { secure?: boolean; maxAge?: number };

test('the recovery marker is cleared with the same Secure attribute it was set with', async () => {
	assert.equal((await clear('https://app.manawg.test')).secure, true);
	assert.notEqual((await clear('http://localhost:3000')).secure, true);
});
